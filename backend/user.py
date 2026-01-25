from fastapi import HTTPException, Request

async def get_user(request: Request): # Only for subsequent connections. On the very first connection there is no cookie yet
    user_id = request.cookies.get("session")

    if not user_id:
        raise HTTPException(401, "Not authenticated")
    
    return user_id

async def create_user(request: Request):
    user_id = "demo"