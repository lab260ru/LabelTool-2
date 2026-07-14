# LabelTool 2 API — production image (docker compose: backend service).
# Startup: migrations → idempotent seed (src/seed.py skips itself if the
# super-admin already exists) → uvicorn on 0.0.0.0:8000.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY alembic.ini ./
COPY alembic ./alembic
COPY src ./src

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && python -m src.seed && exec uvicorn src.main:app --host 0.0.0.0 --port 8000"]
