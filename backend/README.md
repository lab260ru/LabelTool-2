# LabelTool 2 — Backend (FastAPI)

REST API of LabelTool 2: projects, audio upload, annotator tasks, users and
permissions, statistics and dataset export. SQLAlchemy 2 + Alembic, session-based
auth, storage on the local disk or in S3/MinIO.

## Running

```bash
cd backend

# 1. Environment (Python 3.12)
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. DB schema (sqlite ./labeltool2.db by default; overridden by env DATABASE_URL)
.venv/bin/alembic upgrade head

# 3. Seed (creates the super-admin from SUPERUSER_*; set SEED_DEMO=true for demo data)
.venv/bin/python -m src.seed

# 4. Server (http://localhost:8000, OpenAPI: /docs)
.venv/bin/uvicorn src.main:app --reload
```

## Tests

```bash
cd backend && .venv/bin/pytest
```

## Configuration (env / backend/.env)

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./labeltool2.db` | SQLAlchemy connection string |
| `SECRET_KEY` | dev value | Session cookie signing (must be changed in production) |
| `SUPERUSER_LOGIN/SUPERUSER_PASSWORD/SUPERUSER_FIO` | `admin` / dev value / `Administrator` | Super-admin created on first start (change the password) |
| `SEED_DEMO` | `false` | `true` — load demo projects and users |
| `STORAGE_BACKEND` | `local` | `local` (files) or `s3` (S3/MinIO) |
| `LOCAL_STORAGE_DIR` | `./storage` | Local storage directory |
| `S3_ENDPOINT/S3_KEY/S3_SECRET/S3_BUCKET` | — | Access to S3/MinIO (for `STORAGE_BACKEND=s3`) |
| `S3_PUBLIC_ENDPOINT` | — | Public S3 address for presigned URLs (if it differs from `S3_ENDPOINT`) |

## Connecting data from S3 (reference-in-place)

A project can import audio from an EXTERNAL S3/MinIO bucket **by reference**: the bytes
are not copied into the application storage — a fragment (`AudioFragment.source_id`)
points to the object in the source bucket (`S3Source`), and the presigned URL for
playback is generated against that source. Export/consensus/statistics
work with such fragments just like with regular ones.

A source (`S3Source`) is the user's infrastructure config: `endpoint_url`,
`bucket`, `prefix`, `access_key`, `secret_key`, `region?`, `path_style` (true —
for MinIO). `secret_key` is **write-only**: it is stored in the DB but is NEVER
returned by the API and never written to logs.

Endpoints (admin only, all under `/api`):

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/project/{id}/s3-sources` | create a source (the backend checks the connection with `list limit=1`; on failure `400 s3_connection_failed`, nothing is created) |
| GET | `/project/{id}/s3-sources` | list the project's sources (without secrets) + `object_count` |
| DELETE | `/s3-source/{id}` | delete a source (referencing fragments are deleted too; objects in the source bucket are NOT touched) |
| POST | `/s3-source/{id}/preview` | list under the prefix (audio mp3/wav/flac/ogg; for an sbs project — `_a`/`_b` pairs) |
| POST | `/s3-source/{id}/import` | create fragments for new objects (idempotent by `(project_id, s3_key)`); K = `consensus_overlap` tasks per fragment |

Example of connecting a MinIO bucket from docker-compose (substitute your own values —
the demo source is NOT created in `seed.py`: the environment has no access to external S3):

```bash
# create a source for project 1 (admin session in the cookie)
curl -X POST http://localhost:8000/api/project/1/s3-sources \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{
        "name": "MinIO: TTS dataset",
        "endpoint_url": "http://minio:9000",
        "bucket": "audio-corpus",
        "prefix": "tts/2026/",
        "access_key": "minioadmin",
        "secret_key": "minioadmin",
        "path_style": true
      }'
# preview and import
curl -X POST http://localhost:8000/api/s3-source/1/preview -b cookies.txt
curl -X POST http://localhost:8000/api/s3-source/1/import  -b cookies.txt
```

For an sbs project, the objects of a pair are named `<base>_a.<ext>` and `<base>_b.<ext>`
(within the same prefix "folder") — import creates ONE fragment per pair, unpaired
objects are skipped.

## Demo access (after `src.seed` with `SEED_DEMO=true`)

- super-admin — the `SUPERUSER_*` account from the environment;
- `akim`, `porlov` / `Admin12345` — admins;
- `ivolgina`, `skvortsov`, … / `User12345` — labelers (groups BVT/BIN).

## Structure

- `src/main.py` — the application, CORS, `/api/media/{key}`;
- `src/config.py` — settings (env / `.env`);
- `src/db.py`, `src/models.py`, `alembic/` — SQLAlchemy models and migrations;
- `src/auth.py` — session auth (signed cookie + bcrypt) and role dependencies;
- `src/storage.py` — storage abstraction (local disk / S3);
- `src/routers/` — API: `project.py`, `file.py` (upload), `task.py`, `user.py`,
  `export.py`, `s3_source.py`;
- `src/schemas/` — pydantic schemas, 1:1 with the frontend types in `src/api/types.ts`;
- `src/serializers/` — export formats (JSONL, CSV, NeMo, TextGrid, CoNLL, SRT/VTT);
- `src/seed.py` — super-admin bootstrap and demo data;
- `tests/` — pytest, one file per router.
