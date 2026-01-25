import asyncpg
import json
import os
from docs import auth_flow, store_creds, write
from contextlib import asynccontextmanager
from datetime import timedelta
from dotenv import load_dotenv
from fastapi import Body, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from gemini import ask_ai
from google import genai
from search import run_search
from user import get_user

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
app.add_middleware(CORSMiddleware, # Authorizes main to connect to this url (frontend)
                   allow_origins = ["http://localhost:5173","http://127.0.0.1:5173"],
                   allow_credentials = True,
                   allow_methods = ["*"],
                   allow_headers = ["*"])
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
async def auth_callback(code:str, request: Request):
    flow = auth_flow(client_id,client_secret,redirect_uri)
    flow.fetch_token(code=code)
    creds = flow.credentials

    creds_info = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": client_id,
        "client_secret": client_secret,
        "scopes": list(creds.scopes) if creds.scopes else [],
    }

    # Store user creds in db to avoid redundant log-in in every visit
    db_pool = request.app.state.db_pool
    user_id = "demo" # await get_user(request) wont work cuz on the very first connection there is no cookie yet so we create a new id

    return await store_creds(db_pool,user_id,creds_info)

@app.post("/docs/write")
async def write_docs(request: Request, payload: dict = Body(...)): # Body(...) tells that this endpoint requires a JSON body
    db_pool = request.app.state.db_pool
    user_id = "await get_user(request)"

    return await write(db_pool, user_id, payload)