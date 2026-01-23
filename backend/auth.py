from google_auth_oauthlib.flow import Flow

def auth_flow(client_id,client_secret,redirect_uri):
    return Flow.from_client_config(
        {"web":
         {
             "client_id": client_id,
             "client_secret": client_secret,
             "auth_uri": "https://accounts.google.com/o/oauth2/auth",
             "token_uri": "https://oauth2.googleapis.com/token",
             "redirect_uri": [redirect_uri],
         }
        }, scopes=["https://www.googleapis.com/auth/documents"], redirect_uri=redirect_uri)



