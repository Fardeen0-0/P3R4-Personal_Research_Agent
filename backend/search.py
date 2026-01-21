from datetime import timedelta
from fastapi import HTTPException
import asyncpg
import httpx
import json
import re

# normalize query function
def normalize(query: str):
    q = query.lower().strip()
    q = re.sub(r"\s+"," ",q) #regex stuff which is string pattern matching and replacing
    # \s - whitespaces (space, tab, newline), + - one or more, r"" - don't consider the \ as something special
    # i.e. find 'one or more whitespace characters' and replace it with a single space " " in the given query (q)
    return q

async def run_search(query: str, db_pool, cache_ttl: timedelta, key: str, mock: bool):
    if mock:
        return [
            {
                "title": query,
                "url": f"https://www.nevergonnagiveyouup.com/{query}",
                "snippet": "tudududududuududududududu",
            }]
    
    else:
        if not key:
            raise HTTPException(500, "Missing Brave API key")
        URL = "https://api.search.brave.com/res/v1/web/search"
        count = 5                  

        headers = {
            "Accept": "application/json",
            "X-Subscription-Token": key,
        }

        q_norm = normalize(query)
        try:
            # cache check
            async with db_pool.acquire() as conn: #acquire() asks it to lend a free connection from the pool
                row = await conn.fetchrow(
                    """SELECT results FROM cache WHERE query_normalized = $1 AND expires_at > now()""", q_norm # Here $1 is a placeholder for q_norm. Good for security against SQL injection
                )
                if row:
                    cached = row["results"]
                    if isinstance(cached,str):
                        cached = json.loads(cached)
                    await conn.execute(
                        """UPDATE cache SET hit_count = hit_count + 1 WHERE query_normalized = $1""", q_norm
                    )
                    return cached
        
        except asyncpg.PostgresError as e:
            print("DB ERROR during cache lookup:", repr(e))
            raise HTTPException(500, "Database error while reading cache")
        
        params = {
            "q": query,
            "count": count,
        }

        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.get(URL, headers=headers, params=params)
            r.raise_for_status() # Raises status code for anything other than 200s like 400,500 (HTTP doesnt do it itself)

        except httpx.RequestError:
            raise HTTPException(502,"Could not connect to search provider")
        except httpx.HTTPStatusError:
            raise HTTPException(502,"Search provider returned an error")
        data = r.json()

        raw = data.get("web", {}).get("results", [])
        results = [
            {
                "title": item.get("title"),
                "url": item.get("url"),
                "snippet": item.get("description"),
            }
            for item in raw
        ]

        try:
            async with db_pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO cache(query_normalized, query_original, results, provider, expires_at) VALUES ($1,$2,$3,$4,now()+$5) 
                    ON CONFLICT (query_normalized) DO UPDATE SET 
                    results = EXCLUDED.results,
                    expires_at = EXCLUDED.expires_at,
                    provider = EXCLUDED.provider,
                    query_original = EXCLUDED.query_original,
                    hit_count = 0""", # when the cache expires, the query_normalized is going to remain in the table. So when you send the same query again, it's going to try to re-insert it into this primary key column which is going to throw an error and crash the app. That's why we write the on conflict part.
                    # EXCLUDED is the data of the new query that you couldn't add in the existing table
                    q_norm,query,json.dumps(results),"brave",cache_ttl,
                )
        
        except asyncpg.PostgresError as e:
            print("DB ERROR during cache write:", repr(e))
            raise HTTPException(500, "Database error while writing cache")

        return results