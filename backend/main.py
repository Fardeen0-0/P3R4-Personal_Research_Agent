import asyncpg
import os
from contextlib import asynccontextmanager
from datetime import timedelta
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi import Request
from fastapi.responses import RedirectResponse
from gemini import ask_ai
from google import genai
from search import run_search
from auth import auth_flow

load_dotenv()
key = os.getenv("BRAVE_API_KEY")
mock = os.getenv("MOCK_SEARCH","false").lower() == "true"
cache_ttl = timedelta(hours=24) # time to live

# SQL connection
@asynccontextmanager # u need it to run yield
async def lifespan(app: FastAPI): #determines the startup (routine before it starts accepting requests) and shutdown (...after all requests) processes
    #db pool is the connections to SQL that can be reused instead of having to create them every time a request comes
    app.state.db_pool = await asyncpg.create_pool( #app.state is FastAPI's official storage for global app resources. it's an alternative to having a global variable called db_pool
        dsn = os.getenv("DATABASE_URL"), # Data Source Name is the string that tells the client how to connect to the db
        min_size=1,
        max_size=5,
    )

    try:
        yield
    finally: # runs no matter what, whether the code goes thru successfully or crashes
        await app.state.db_pool.close()


app = FastAPI(lifespan=lifespan)

client = genai.Client()

@app.get("/ask")
async def ask(query: str, request: Request):
    db_pool = request.app.state.db_pool
    web_results = await run_search(query, db_pool, cache_ttl, key, mock)
    response = ask_ai(query, web_results,client)
    return {"query":query, "results": response}

client_id=os.environ["GOOGLE_CLIENT_ID"]
client_secret=os.environ["GOOGLE_CLIENT_SECRET"]
redirect_uri=os.environ["GOOGLE_REDIRECT_URI"]

@app.get("/auth/google/start")
async def auth_start():
    flow = auth_flow(client_id,client_secret,redirect_uri)
    auth_url, state =  flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return RedirectResponse(auth_url)

@app.get("/auth/google/callback")
async def auth_callback(code):
    flow = auth_flow(client_id,client_secret,redirect_uri)
    flow.fetch_token(code=code)
    creds = flow.credentials