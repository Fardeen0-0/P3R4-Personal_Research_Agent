import json
import re
from fastapi import HTTPException
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

def auth_flow(client_id,client_secret,redirect_uri):
    return Flow.from_client_config(
        {"web":
         {
             "client_id": client_id,
             "client_secret": client_secret,
             "auth_uri": "https://accounts.google.com/o/oauth2/auth",
             "token_uri": "https://oauth2.googleapis.com/token",
             "redirect_uris": [redirect_uri],
         }
        }, scopes=["https://www.googleapis.com/auth/documents", "openid"], redirect_uri=redirect_uri) # Openid to get user id

def build_docs_service(creds: str):
    service = build("docs","v1",credentials=creds)
    return service

def extract_docs_id(link: str):
    s = link.strip()
    if '/' not in s: # It might be the doc id itself
        return s
    i = re.search("/d/([a-zA-Z0-9]+)",s) # + means one or more of those characters
    if not i:
        raise HTTPException(400, "Invalid Google Docs link or id")
    return i.group(1)

async def store_creds(db_pool, user_id, creds):
    async with db_pool.acquire() as conn:
        await conn.execute(
            '''INSERT INTO google_tokens (user_id, creds) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET creds=EXCLUDED.creds, updated_at=now()''',user_id,json.dumps(creds)
        )
        return {"status": "google_connected"}
    
async def write(db_pool, user_id, payload: dict):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            '''SELECT creds FROM google_tokens WHERE user_id=$1''',user_id
        )
        if not row:
            raise HTTPException(401,"Google account not connected")
        
        creds_info = row["creds"]
        if isinstance(creds_info, str):
            creds_info = json.loads(creds_info)

        creds = Credentials.from_authorized_user_info(creds_info,scopes=creds_info.get("scopes",[])) # Rebuilding creds here cuz u cant store a python object in sql. upon retrieving it I'm makin it back to an object

        docs_service = build_docs_service(creds)

        # Appends text at the end of the document. This is given in docs API documentation i blv
        requests_body = {
            "requests": [
                {
                    "insertText": {
                        "text": payload["text"],
                        "endOfSegmentLocation": {} # inserted at the end of the doc to start text from there next time
                    }
                }
            ]
        }

        docs_service.documents().batchUpdate(documentId = extract_docs_id(payload["doc_id"]), body = requests_body).execute()

        return {"status": "ok"}
