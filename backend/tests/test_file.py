"""Tests for session batch upload (routers/file.py).

Coverage per plan: duplicates (reject/rename), format (extension + magic
bytes), size (≤200 MB), CSV/JSONL manifest (valid/broken lines),
non-admin gets 403, UploadSession counters.
"""

import uuid

import pytest
from sqlalchemy import select

from src.models import AudioFragment, Project, TaskType, UploadSession
from tests.conftest import ADMIN_PASSWORD, login_as

# ---------------------------------------------------------------------------
# Valid magic bytes (>=12 bytes)
# ---------------------------------------------------------------------------

WAV = b"RIFF" + (36).to_bytes(4, "little") + b"WAVE" + b"fmt " + b"\x00" * 64
MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\xff" * 64
FLAC = b"fLaC" + b"\x00" * 64
OGG = b"OggS" + b"\x00" * 64


@pytest.fixture(autouse=True)
def _clear_upload_state():
    """In-memory upload state must not leak between tests."""
    from src.routers import file as file_router

    file_router._SESSIONS.clear()
    file_router._MANIFESTS.clear()
    file_router._MANIFEST_ERRORS.clear()
    yield


@pytest.fixture()
def project(db_session) -> Project:
    p = Project(name="Радио-архив 2024", task_type=TaskType.transcription)
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


def make_project(db_session, name: str, task_type: TaskType) -> Project:
    p = Project(name=name, task_type=task_type)
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


def seed_fragment(db_session, project_id: int, filename: str) -> AudioFragment:
    frag = AudioFragment(
        project_id=project_id,
        filename=filename,
        s3_key=f"seed/{uuid.uuid4().hex}_{filename}",
        size_bytes=10,
        task_type=TaskType.transcription,
        meta={},
    )
    db_session.add(frag)
    db_session.commit()
    db_session.refresh(frag)
    return frag


def make_session(client, project_id: int, files: list[dict], **kw) -> dict:
    # task_type in the body is DEPRECATED (the type comes from the project) — we
    # deliberately send a value to verify the server ignores it
    body = {
        "project_id": project_id,
        "task_type": "transcription",
        "metadata": {},
        "orig_trb": {},
        "files": files,
    }
    body.update(kw)
    resp = client.post("/api/upload/session", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def fmeta(client_id: str, filename: str, size: int = 100, duration: float | None = 2.5) -> dict:
    return {"client_id": client_id, "filename": filename, "size": size, "duration": duration}


def fragments_of(db_session, project_id: int) -> list[AudioFragment]:
    db_session.rollback()  # close the reading transaction, see other commits
    return list(
        db_session.execute(
            select(AudioFragment).where(AudioFragment.project_id == project_id)
        ).scalars()
    )


def session_row(db_session, session_db_id: int | None = None) -> UploadSession:
    db_session.rollback()
    rows = list(db_session.execute(select(UploadSession)).scalars())
    if session_db_id is not None:
        return next(r for r in rows if r.id == session_db_id)
    assert rows, "no UploadSession rows"
    return rows[-1]


# ---------------------------------------------------------------------------
# Authorization: only an admin session
# ---------------------------------------------------------------------------


def test_unauthenticated_gets_401(client):
    assert client.post("/api/upload/session", json={}).status_code == 401
    assert client.post("/api/file/batch").status_code == 401
    assert client.get("/api/project/1/files/conflicts").status_code == 401


def test_non_admin_gets_403(user_client):
    body = {"project_id": 1, "task_type": "transcription", "files": []}
    assert user_client.post("/api/upload/session", json=body).status_code == 403
    assert user_client.post("/api/upload/session/x/finish").status_code == 403
    assert user_client.post("/api/file/batch").status_code == 403
    assert user_client.get("/api/project/1/files/conflicts").status_code == 403
    assert user_client.post("/api/project/1/manifest").status_code == 403
    assert (
        user_client.post(
            "/api/upload/manifest/preview", files={"file": ("m.csv", b"filename\na.wav\n")}
        ).status_code
        == 403
    )
    assert user_client.get("/api/file/upload-sessions/1").status_code == 403


# ---------------------------------------------------------------------------
# Session creation: detect conflicts and rejects BEFORE writing
# ---------------------------------------------------------------------------


def test_create_session_reports_duplicates_and_unsupported(admin_client, db_session, project):
    seed_fragment(db_session, project.id, "a.wav")
    info = make_session(
        admin_client,
        project.id,
        [
            fmeta("f1", "a.wav"),  # conflict with the project
            fmeta("f2", "b.mp3"),
            fmeta("f3", "notes.txt"),  # rejected by format
            fmeta("f4", "b.mp3"),  # duplicate within the batch
        ],
    )
    assert info["duplicates"] == ["a.wav", "b.mp3"]
    assert info["unsupported"] == ["notes.txt"]
    assert isinstance(info["session_id"], str) and info["session_id"]

    row = session_row(db_session)
    assert (row.total, row.succeeded, row.failed) == (4, 0, 0)
    # nothing created before writing
    assert len(fragments_of(db_session, project.id)) == 1


def test_create_session_unknown_project(admin_client):
    resp = admin_client.post(
        "/api/upload/session",
        json={"project_id": 999, "task_type": "transcription", "files": []},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "project_not_found"


# ---------------------------------------------------------------------------
# Uploading session files
# ---------------------------------------------------------------------------


def test_session_file_upload_success(admin_client, db_session, project):
    info = make_session(
        admin_client,
        project.id,
        [fmeta("f1", "one.mp3", size=len(MP3)), fmeta("f2", "two.wav", size=len(WAV))],
        metadata={"source": "radio"},
        orig_trb={"f1": "пофайловый текст"},
        orig_trb_all="массовый текст",
    )
    sid = info["session_id"]

    r1 = admin_client.post(f"/api/upload/session/{sid}/file/f1", content=MP3)
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert body1["ok"] is True
    assert body1["client_id"] == "f1"
    assert body1["fragment_id"] is not None
    assert body1["error_reason"] is None

    r2 = admin_client.post(f"/api/upload/session/{sid}/file/f2", content=WAV)
    assert r2.json()["ok"] is True

    frags = {f.filename: f for f in fragments_of(db_session, project.id)}
    assert set(frags) == {"one.mp3", "two.wav"}
    one = frags["one.mp3"]
    assert one.orig_trb == "пофайловый текст"  # per-file
    assert frags["two.wav"].orig_trb == "массовый текст"  # bulk
    assert one.meta == {"source": "radio"}
    assert one.size_bytes == len(MP3)
    assert one.duration_sec == 2.5
    assert one.task_type == TaskType.transcription
    assert one.s3_key.startswith(f"project_{project.id}/")

    # the file is actually written to storage
    from src.storage import get_storage

    assert get_storage().get(one.s3_key) == MP3

    row = session_row(db_session)
    assert (row.total, row.succeeded, row.failed) == (2, 2, 0)


def test_session_file_bad_magic_bytes(admin_client, db_session, project):
    info = make_session(admin_client, project.id, [fmeta("f1", "fake.wav")])
    resp = admin_client.post(
        f"/api/upload/session/{info['session_id']}/file/f1", content="это не WAV, а текст".encode()
    )
    # a business error does not break the batch: 200 + ok=false
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["error_reason"] == "unsupported_format"
    assert fragments_of(db_session, project.id) == []
    row = session_row(db_session)
    assert (row.succeeded, row.failed) == (0, 1)


def test_session_file_unsupported_extension(admin_client, project):
    info = make_session(admin_client, project.id, [fmeta("f1", "sound.aiff")])
    resp = admin_client.post(f"/api/upload/session/{info['session_id']}/file/f1", content=WAV)
    assert resp.json()["error_reason"] == "unsupported_format"


def test_session_file_too_large(admin_client, project, monkeypatch):
    monkeypatch.setattr("src.routers.file.MAX_FILE_SIZE_BYTES", 64)
    info = make_session(admin_client, project.id, [fmeta("f1", "big.wav")])
    resp = admin_client.post(f"/api/upload/session/{info['session_id']}/file/f1", content=WAV)
    assert resp.json()["ok"] is False
    assert resp.json()["error_reason"] == "file_too_large"


def test_duplicate_conflict_reject(admin_client, db_session, project):
    seed_fragment(db_session, project.id, "a.wav")
    info = make_session(admin_client, project.id, [fmeta("f1", "a.wav")], conflict="reject")
    assert info["duplicates"] == ["a.wav"]

    resp = admin_client.post(f"/api/upload/session/{info['session_id']}/file/f1", content=WAV)
    assert resp.status_code == 200
    assert resp.json()["ok"] is False
    assert resp.json()["error_reason"] == "duplicate_name"
    # nothing created or overwritten
    assert len(fragments_of(db_session, project.id)) == 1


def test_duplicate_conflict_rename(admin_client, db_session, project):
    original = seed_fragment(db_session, project.id, "a.wav")
    info = make_session(admin_client, project.id, [fmeta("f1", "a.wav")])  # rename by default

    resp = admin_client.post(f"/api/upload/session/{info['session_id']}/file/f1", content=WAV)
    assert resp.json()["ok"] is True

    frags = {f.filename: f for f in fragments_of(db_session, project.id)}
    # no silent overwrite: the original stays, the new one gets a unique name/key
    assert set(frags) == {"a.wav", "a (2).wav"}
    assert frags["a.wav"].s3_key == original.s3_key
    assert frags["a (2).wav"].s3_key != original.s3_key


def test_unknown_session_and_file_404(admin_client, project):
    assert admin_client.post("/api/upload/session/ses-nope/file/f1", content=WAV).status_code == 404
    info = make_session(admin_client, project.id, [fmeta("f1", "a.wav")])
    resp = admin_client.post(f"/api/upload/session/{info['session_id']}/file/ghost", content=WAV)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "file_not_in_session"


def test_finish_session_summary(admin_client, db_session, project):
    info = make_session(
        admin_client,
        project.id,
        [fmeta("f1", "ok.flac"), fmeta("f2", "bad.ogg"), fmeta("f3", "queued.mp3")],
    )
    sid = info["session_id"]
    admin_client.post(f"/api/upload/session/{sid}/file/f1", content=FLAC)
    admin_client.post(f"/api/upload/session/{sid}/file/f2", content="мусор вместо ogg".encode())
    # f3 not uploaded ('Queued'/cancelled) — not counted as failed

    resp = admin_client.post(f"/api/upload/session/{sid}/finish")
    assert resp.status_code == 200
    summary = resp.json()
    assert summary["project_id"] == project.id
    assert summary["task_type"] == "transcription"
    assert summary["total"] == 3
    assert summary["uploaded"] == 1
    assert summary["error_rows_url"] is None
    assert summary["failed"] == [
        {"client_id": "f2", "filename": "bad.ogg", "reason": "unsupported_format"}
    ]

    row = session_row(db_session)
    assert (row.total, row.succeeded, row.failed) == (3, 1, 1)


# ---------------------------------------------------------------------------
# CSV/JSONL manifest
# ---------------------------------------------------------------------------

MANIFEST_CSV = (
    "filename,task_type,text,source\n"
    "a1.mp3,transcription,привет мир,radio\n"
    ",transcription,без имени,radio\n"
    "bad.txt,transcription,текст,radio\n"
    "a2.wav,weird_type,ещё,radio\n"
)


def test_manifest_preview_csv(admin_client):
    resp = admin_client.post(
        "/api/upload/manifest/preview", files={"file": ("man.csv", MANIFEST_CSV.encode())}
    )
    assert resp.status_code == 200, resp.text
    preview = resp.json()
    assert preview["filename"] == "man.csv"
    assert preview["columns"] == ["filename", "task_type", "text", "source"]
    assert preview["total_rows"] == 4
    assert preview["valid_count"] == 2
    assert preview["error_count"] == 2
    assert preview["suggested_mapping"] == {
        "filename": "filename",
        # the column is recognized (and not put into metadata) but ignored:
        # the type is set by the project
        "task_type": "task_type",
        "orig_trb": "text",
        # sbs pair columns not found in a regular manifest — null
        "filename_a": None,
        "filename_b": None,
        "metadata": {"source": "source"},
    }
    rows = preview["rows"]
    # row 4 with weird_type is valid: task_type values are no longer validated
    assert [r["valid"] for r in rows] == [True, False, False, True]
    assert rows[0]["index"] == 1
    assert rows[0]["cells"]["filename"] == "a1.mp3"
    assert rows[1]["error"] == "missing_filename"
    assert rows[2]["error"] == "unsupported_format"
    assert rows[3]["error"] is None


def test_manifest_preview_jsonl_with_broken_line(admin_client):
    jsonl = (
        '{"audio_filepath": "x1.wav", "text": "т1"}\n'
        "не-json строка\n"
        '{"audio_filepath": "x2.flac", "text": "т2"}\n'
    )
    resp = admin_client.post(
        "/api/upload/manifest/preview", files={"file": ("man.jsonl", jsonl.encode())}
    )
    assert resp.status_code == 200, resp.text
    preview = resp.json()
    assert preview["columns"] == ["audio_filepath", "text"]
    assert preview["suggested_mapping"]["filename"] == "audio_filepath"
    assert preview["suggested_mapping"]["orig_trb"] == "text"
    assert preview["total_rows"] == 3
    assert preview["valid_count"] == 2
    assert preview["rows"][1]["valid"] is False
    assert preview["rows"][1]["error"] == "parse_error"


def test_manifest_preview_empty_400(admin_client):
    resp = admin_client.post("/api/upload/manifest/preview", files={"file": ("man.csv", b"")})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "empty_manifest"


def test_manifest_import_into_session(admin_client, db_session, project):
    info = make_session(admin_client, project.id, [], metadata={"batch": "b1"})
    sid = info["session_id"]
    admin_client.post(
        "/api/upload/manifest/preview", files={"file": ("man.csv", MANIFEST_CSV.encode())}
    )

    mapping = {
        "filename": "filename",
        "task_type": "task_type",
        "orig_trb": "text",
        "metadata": {"source": "source"},
    }
    resp = admin_client.post(f"/api/upload/session/{sid}/manifest", json={"mapping": mapping})
    assert resp.status_code == 200, resp.text
    summary = resp.json()
    assert summary["project_id"] == project.id
    assert summary["total"] == 4
    # the row with weird_type is imported: the task_type column is ignored
    assert summary["uploaded"] == 2
    assert summary["task_type"] == "transcription"  # project type
    assert summary["error_rows_url"] == "/api/upload/manifest/errors.csv"
    assert {(f["client_id"], f["reason"]) for f in summary["failed"]} == {
        ("manifest-row-2", "invalid_row"),
        ("manifest-row-3", "unsupported_format"),
    }

    frags = {f.filename: f for f in fragments_of(db_session, project.id)}
    assert set(frags) == {"a1.mp3", "a2.wav"}
    frag = frags["a1.mp3"]
    assert frag.orig_trb == "привет мир"
    assert frag.meta == {"batch": "b1", "source": "radio"}  # batch metadata + columns
    # all rows inherit the project type (including the one with weird_type in the column)
    assert all(f.task_type == TaskType.transcription for f in frags.values())

    # session counters account for manifest rows
    row = session_row(db_session)
    assert (row.total, row.succeeded, row.failed) == (4, 2, 2)

    # 'Download rows with errors'
    errors = admin_client.get("/api/upload/manifest/errors.csv")
    assert errors.status_code == 200
    assert errors.headers["content-type"].startswith("text/csv")
    assert "bad.txt" in errors.text and "unsupported_format" in errors.text


def test_manifest_import_mapping_required(admin_client, project):
    info = make_session(admin_client, project.id, [])
    resp = admin_client.post(f"/api/upload/session/{info['session_id']}/manifest", json={})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "mapping_required"


def test_manifest_import_without_preview_404(admin_client, project):
    info = make_session(admin_client, project.id, [])
    resp = admin_client.post(
        f"/api/upload/session/{info['session_id']}/manifest",
        json={"mapping": {"filename": "filename"}},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "manifest_not_found"


def test_manifest_import_unknown_column_400(admin_client, project):
    info = make_session(admin_client, project.id, [])
    admin_client.post(
        "/api/upload/manifest/preview", files={"file": ("man.csv", MANIFEST_CSV.encode())}
    )
    resp = admin_client.post(
        f"/api/upload/session/{info['session_id']}/manifest",
        json={"mapping": {"filename": "no_such_column"}},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "unknown_column"


# ---------------------------------------------------------------------------
# One-step endpoints
# ---------------------------------------------------------------------------


def test_batch_upload_mixed(admin_client, db_session, project):
    seed_fragment(db_session, project.id, "a.wav")
    resp = admin_client.post(
        "/api/file/batch",
        data={
            "project_id": str(project.id),
            "task_type": "classification",
            "conflict": "rename",
            "metadata": '{"source": "radio"}',
            "orig_trb": '{"new.mp3": "текст нью"}',
            "orig_trb_all": "общий текст",
        },
        files=[
            ("files", ("new.mp3", MP3, "audio/mpeg")),
            ("files", ("a.wav", WAV, "audio/wav")),  # duplicate -> rename
            ("files", ("doc.txt", "привет, это не аудио".encode(), "text/plain")),
        ],
    )
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["project_id"] == project.id
    assert out["task_type"] == "transcription"  # project type, not the form's
    assert out["total"] == 3
    assert out["uploaded"] == 2

    by_name = {r["filename"]: r for r in out["results"]}
    assert by_name["new.mp3"]["ok"] is True
    assert by_name["new.mp3"]["stored_as"] == "new.mp3"
    assert by_name["a.wav"]["ok"] is True
    assert by_name["a.wav"]["stored_as"] == "a (2).wav"  # unique name, no overwrite
    assert by_name["doc.txt"]["ok"] is False
    assert by_name["doc.txt"]["error_reason"] == "unsupported_format"
    assert out["failed"] == [
        {"client_id": "doc.txt", "filename": "doc.txt", "reason": "unsupported_format"}
    ]

    frags = {f.filename: f for f in fragments_of(db_session, project.id)}
    assert set(frags) == {"a.wav", "new.mp3", "a (2).wav"}
    assert frags["new.mp3"].orig_trb == "текст нью"  # per-file
    assert frags["a (2).wav"].orig_trb == "общий текст"  # bulk
    assert frags["new.mp3"].meta == {"source": "radio"}
    # task_type=classification in the form is ignored — the type is inherited from the project
    assert frags["new.mp3"].task_type == TaskType.transcription

    row = session_row(db_session, out["upload_session_id"])
    assert (row.total, row.succeeded, row.failed) == (3, 2, 1)


def test_batch_upload_conflict_reject(admin_client, db_session, project):
    seed_fragment(db_session, project.id, "a.wav")
    resp = admin_client.post(
        "/api/file/batch",
        data={"project_id": str(project.id), "task_type": "transcription", "conflict": "reject"},
        files=[("files", ("a.wav", WAV, "audio/wav"))],
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["uploaded"] == 0
    assert out["results"][0]["error_reason"] == "duplicate_name"
    assert len(fragments_of(db_session, project.id)) == 1  # no silent overwrite


def test_conflicts_endpoint(admin_client, db_session, project):
    seed_fragment(db_session, project.id, "a.wav")
    seed_fragment(db_session, project.id, "c.ogg")
    resp = admin_client.get(
        f"/api/project/{project.id}/files/conflicts",
        params={"names": ["a.wav,b.mp3", "c.ogg"]},
    )
    assert resp.status_code == 200
    assert resp.json() == {"project_id": project.id, "duplicates": ["a.wav", "c.ogg"]}

    assert admin_client.get("/api/project/999/files/conflicts").status_code == 404


def test_project_manifest_endpoint(admin_client, db_session, project):
    seed_fragment(db_session, project.id, "dup.wav")
    manifest = "filename,text\nnew1.mp3,первый\ndup.wav,второй\nbad.doc,третий\n"
    resp = admin_client.post(
        f"/api/project/{project.id}/manifest",
        data={
            "mapping": '{"filename": "filename", "orig_trb": "text", "metadata": {}}',
            "task_type": "verification",
            "conflict": "reject",
        },
        files={"file": ("man.csv", manifest.encode())},
    )
    assert resp.status_code == 200, resp.text
    summary = resp.json()
    # task_type=verification in the form is ignored — project type
    assert summary["task_type"] == "transcription"
    assert summary["total"] == 3
    assert summary["uploaded"] == 1
    assert {(f["filename"], f["reason"]) for f in summary["failed"]} == {
        ("dup.wav", "duplicate_name"),
        ("bad.doc", "unsupported_format"),
    }
    assert summary["error_rows_url"] == "/api/upload/manifest/errors.csv"

    frags = {f.filename: f for f in fragments_of(db_session, project.id)}
    assert "new1.mp3" in frags
    assert frags["new1.mp3"].orig_trb == "первый"

    row = session_row(db_session)
    assert (row.total, row.succeeded, row.failed) == (3, 1, 2)


def test_project_manifest_bad_mapping(admin_client, project):
    resp = admin_client.post(
        f"/api/project/{project.id}/manifest",
        data={"mapping": '{"task_type": null}', "task_type": "transcription"},
        files={"file": ("man.csv", b"filename\na.wav\n")},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "mapping_required"


def test_upload_sessions_history(client, db_session, project, admin_user, super_admin):
    login_as(client, admin_user.login, ADMIN_PASSWORD)
    make_session(client, project.id, [fmeta("f1", "a.wav")])
    make_session(client, project.id, [fmeta("f1", "b.mp3"), fmeta("f2", "c.ogg")])

    resp = client.get(f"/api/file/upload-sessions/{project.id}")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 2
    assert items[0]["total"] == 2  # newest first
    assert items[1]["total"] == 1
    assert items[0]["project_id"] == project.id
    assert items[0]["user_id"] == admin_user.id
    assert {"id", "total", "succeeded", "failed", "created_at"} <= set(items[0])

    assert client.get("/api/file/upload-sessions/999").status_code == 404


# ---------------------------------------------------------------------------
# An uploaded fragment immediately gets an open task,
# so /task/random hands out work without a separate 'create tasks' step
# ---------------------------------------------------------------------------


def test_uploaded_fragment_spawns_open_task(admin_client, db_session, project):
    from src.models import Task, TaskStatus

    info = make_session(admin_client, project.id, [fmeta("f1", "with-task.wav")])
    resp = admin_client.post(f"/api/upload/session/{info['session_id']}/file/f1", content=WAV)
    assert resp.status_code == 200 and resp.json()["ok"] is True
    fragment_id = resp.json()["fragment_id"]

    db_session.rollback()
    tasks = list(db_session.execute(select(Task).where(Task.fragment_id == fragment_id)).scalars())
    assert len(tasks) == 1
    assert tasks[0].status == TaskStatus.open
    assert tasks[0].user_id is None


# ---------------------------------------------------------------------------
# Project type inheritance (model change: a single type per project)
# ---------------------------------------------------------------------------


def test_upload_inherits_project_task_type(admin_client, db_session):
    """Fragments inherit Project.task_type; the client's task_type is ignored
    by all upload paths (session, /file/batch, manifest)."""
    mos_project = make_project(db_session, "Оценка синтеза TTS", TaskType.mos)

    # 1) session upload: transcription in the session body — ignored
    info = make_session(admin_client, mos_project.id, [fmeta("f1", "tts1.wav")])
    resp = admin_client.post(f"/api/upload/session/{info['session_id']}/file/f1", content=WAV)
    assert resp.status_code == 200 and resp.json()["ok"] is True

    summary = admin_client.post(f"/api/upload/session/{info['session_id']}/finish").json()
    assert summary["task_type"] == "mos"

    # 2) one-step batch: form without task_type (field deprecated, optional)
    resp = admin_client.post(
        "/api/file/batch",
        data={"project_id": str(mos_project.id)},
        files=[("files", ("tts2.wav", WAV, "audio/wav"))],
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["task_type"] == "mos"

    # 3) manifest: also without task_type
    resp = admin_client.post(
        f"/api/project/{mos_project.id}/manifest",
        data={"mapping": '{"filename": "filename", "metadata": {}}'},
        files={"file": ("man.csv", b"filename\ntts3.mp3\n")},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["task_type"] == "mos"

    frags = fragments_of(db_session, mos_project.id)
    assert {f.filename for f in frags} == {"tts1.wav", "tts2.wav", "tts3.mp3"}
    assert all(f.task_type == TaskType.mos for f in frags)


def test_manifest_import_spawns_open_tasks(admin_client, db_session, project):
    from src.models import Task, TaskStatus

    csv_data = "filename,text\nrow1.wav,привет\nrow2.mp3,мир\n"
    preview = admin_client.post(
        "/api/upload/manifest/preview",
        files={"file": ("m.csv", csv_data.encode(), "text/csv")},
    )
    assert preview.status_code == 200
    info = make_session(admin_client, project.id, [])
    resp = admin_client.post(
        f"/api/upload/session/{info['session_id']}/manifest",
        json={"mapping": preview.json()["suggested_mapping"]},
    )
    assert resp.status_code == 200
    assert resp.json()["uploaded"] == 2

    db_session.rollback()
    fragment_ids = [f.id for f in fragments_of(db_session, project.id)]
    tasks = list(
        db_session.execute(select(Task).where(Task.fragment_id.in_(fragment_ids))).scalars()
    )
    assert len(tasks) == 2
    assert all(t.status == TaskStatus.open for t in tasks)
