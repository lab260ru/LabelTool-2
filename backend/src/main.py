"""LabelTool 2 API application.

Tables are created by Alembic migrations (alembic upgrade head), not by the app.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from src import auth
from src.routers import export, file, project, s3_source, task, user
from src.storage import LocalStorage, get_storage

app = FastAPI(title="LabelTool 2 API", version="0.1.0")

# CORS: frontend (Vite dev) on a separate origin + cookie sessions
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(file.router, prefix="/api")
app.include_router(export.router, prefix="/api")
app.include_router(project.router, prefix="/api")
app.include_router(s3_source.router, prefix="/api")
app.include_router(task.router, prefix="/api")
app.include_router(user.router, prefix="/api")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/media/{key:path}")
def media(key: str):
    """Serving LocalStorage files (the local-mode "presigned" URL).

    Not used in s3 mode: the presigned URL points directly to S3/MinIO.
    """
    storage = get_storage()
    if not isinstance(storage, LocalStorage):
        raise HTTPException(status_code=404, detail="local storage is disabled")
    try:
        path = storage._path(key)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid key")
    if not path.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(path)
