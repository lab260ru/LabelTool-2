"""Tests for the 'Side-by-Side (SBS)' feature — the 7th task type, blind pairwise comparison.

Coverage per contract:
  - Project.sbs_systems: default when creating an sbs project, round-trip of custom
    names, PATCH freely (including when done), null/ignored for non-sbs, validation
    of empty names — 422 'bad_sbs_systems'; names visible ONLY to the admin;
    label_list/mos_scales for sbs — null;
  - Upload: pairs by _a/_b suffixes (a full pair → 1 fragment + K tasks;
    an unpaired file → 'unpaired'); manifest filename_a/filename_b;
  - Task.swap: randomization across tasks, payload order when swap true/false;
  - submit: preference normalization by swap, validation -2..2 → 422 'bad_result';
  - export jsonl/csv (audio_b, preference, systems), tabular-only formats;
  - consensus majority on the normalized result.
"""

import csv as csv_lib
import io
import json
import tarfile
import uuid
import zipfile
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from src.auth import hash_password
from src.models import (
    DEFAULT_SBS_SYSTEMS,
    AudioFragment,
    Project,
    Task,
    TaskStatus,
    TaskType,
    User,
    UserRole,
    utcnow,
)
from tests.conftest import USER_PASSWORD, login_as

# Valid WAV magic bytes (>=12 bytes) — as in tests/test_file.py
WAV = b"RIFF" + (36).to_bytes(4, "little") + b"WAVE" + b"fmt " + b"\x00" * 64
WAV2 = b"RIFF" + (40).to_bytes(4, "little") + b"WAVE" + b"fmt " + b"\x01" * 64

CUSTOM_SYSTEMS = {"a": "YourTTS", "b": "XTTS-v2"}


@pytest.fixture(autouse=True)
def _clear_upload_state():
    from src.routers import file as file_router

    file_router._SESSIONS.clear()
    file_router._MANIFESTS.clear()
    file_router._MANIFEST_ERRORS.clear()
    yield


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def create_project(admin_client, task_type="sbs", name="Сравнение TTS-движков", **extra):
    resp = admin_client.post(
        "/api/projects", json={"name": name, "task_type": task_type, **extra}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def make_sbs_project(db, systems=None, name="Сравнение TTS", overlap=2) -> Project:
    """sbs project directly in the DB; participants — all users (for /task/random)."""
    project = Project(
        name=name,
        task_type=TaskType.sbs,
        label_list=[],
        consensus_overlap=overlap,
        sbs_systems=systems or dict(DEFAULT_SBS_SYSTEMS),
    )
    project.participants = list(db.execute(select(User)).scalars())
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def make_pair_fragment(db, project, base="sbs_0001", **kw) -> AudioFragment:
    fragment = AudioFragment(
        project_id=project.id,
        filename=f"{base}_a.wav",
        s3_key=f"p{project.id}/{uuid.uuid4().hex}-{base}_a.wav",
        size_bytes=1000,
        duration_sec=2.5,
        filename_b=f"{base}_b.wav",
        s3_key_b=f"p{project.id}/{uuid.uuid4().hex}-{base}_b.wav",
        size_bytes_b=1100,
        duration_sec_b=2.7,
        task_type=TaskType.sbs,
        meta={},
        **kw,
    )
    db.add(fragment)
    db.commit()
    db.refresh(fragment)
    return fragment


def make_task(db, fragment, status=TaskStatus.open, swap=None, user_id=None, **kw) -> Task:
    task = Task(fragment_id=fragment.id, status=status, swap=swap, user_id=user_id, **kw)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def make_user(db, login) -> User:
    user = User(
        login=login, password_hash=hash_password(USER_PASSWORD),
        fio=login.title(), role=UserRole.user, permissions={},
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Project.sbs_systems: default, round-trip, PATCH, visibility, validation
# ---------------------------------------------------------------------------


def test_create_sbs_project_gets_default_systems(admin_client):
    body = create_project(admin_client)
    assert body["sbs_systems"] == DEFAULT_SBS_SYSTEMS
    # label_list/mos_scales are not applicable for sbs — null
    assert body["label_list"] is None
    assert body["mos_scales"] is None
    got = admin_client.get(f"/api/project/{body['id']}").json()
    assert got["sbs_systems"] == DEFAULT_SBS_SYSTEMS
    assert got["label_list"] is None


def test_create_sbs_project_with_custom_systems_roundtrip(admin_client):
    body = create_project(admin_client, sbs_systems=CUSTOM_SYSTEMS)
    assert body["sbs_systems"] == CUSTOM_SYSTEMS
    got = admin_client.get(f"/api/project/{body['id']}").json()
    assert got["sbs_systems"] == CUSTOM_SYSTEMS


def test_create_sbs_systems_strips_names(admin_client):
    body = create_project(admin_client, sbs_systems={"a": "  Движок 1  ", "b": " Движок 2 "})
    assert body["sbs_systems"] == {"a": "Движок 1", "b": "Движок 2"}


def test_create_non_sbs_project_ignores_systems(admin_client):
    body = create_project(
        admin_client, task_type="transcription", name="Радио", sbs_systems=CUSTOM_SYSTEMS
    )
    assert body["sbs_systems"] is None
    # for a non-sbs project label_list stays a list
    assert body["label_list"] == []


@pytest.mark.parametrize(
    "bad_systems",
    [
        {"a": "", "b": "B"},
        {"a": "A", "b": ""},
        {"a": "   ", "b": "B"},
        {"a": "A", "b": "   "},
    ],
)
def test_create_sbs_systems_validation_422(admin_client, bad_systems):
    resp = admin_client.post(
        "/api/projects", json={"name": "X", "task_type": "sbs", "sbs_systems": bad_systems}
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == "bad_sbs_systems"


def test_patch_sbs_systems_free_even_with_done(admin_client, db_session, regular_user):
    project = create_project(admin_client)
    db_project = db_session.get(Project, project["id"])
    fragment = make_pair_fragment(db_session, db_project)
    make_task(
        db_session, fragment, status=TaskStatus.done, user_id=regular_user.id,
        result={"type": "sbs", "preference": -1}, started_at=utcnow(), finished_at=utcnow(),
    )
    # system names can be changed FREELY even with done tasks (it is just labeling)
    resp = admin_client.patch(
        f"/api/project/{project['id']}", json={"sbs_systems": CUSTOM_SYSTEMS}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["sbs_systems"] == CUSTOM_SYSTEMS


def test_patch_sbs_systems_validation_422(admin_client):
    project = create_project(admin_client)
    resp = admin_client.patch(
        f"/api/project/{project['id']}", json={"sbs_systems": {"a": "A", "b": ""}}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "bad_sbs_systems"


def test_patch_task_type_switch_sets_and_clears_systems(admin_client):
    project = create_project(admin_client, task_type="transcription", name="Пустой")
    resp = admin_client.patch(f"/api/project/{project['id']}", json={"task_type": "sbs"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["sbs_systems"] == DEFAULT_SBS_SYSTEMS

    resp = admin_client.patch(
        f"/api/project/{project['id']}", json={"task_type": "transcription"}
    )
    assert resp.status_code == 200
    assert resp.json()["sbs_systems"] is None

    # type switch + explicit names in one PATCH — the explicit ones apply
    resp = admin_client.patch(
        f"/api/project/{project['id']}", json={"task_type": "sbs", "sbs_systems": CUSTOM_SYSTEMS}
    )
    assert resp.status_code == 200
    assert resp.json()["sbs_systems"] == CUSTOM_SYSTEMS


def test_sbs_systems_hidden_from_annotator(client, db_session, admin_user):
    """System names are visible ONLY to the admin — for the annotator they are null in the project list."""
    project = make_sbs_project(db_session, systems=CUSTOM_SYSTEMS)
    annotator = make_user(db_session, "labeler-sbs")
    project.participants.append(annotator)
    db_session.commit()

    # the admin sees the names
    login_as(client, admin_user.login, "Admin12345")
    admin_projects = client.get("/api/projects").json()
    admin_row = next(p for p in admin_projects if p["id"] == project.id)
    assert admin_row["sbs_systems"] == CUSTOM_SYSTEMS

    # the annotator — null (blind comparison)
    login_as(client, annotator.login, USER_PASSWORD)
    user_projects = client.get("/api/projects").json()
    user_row = next(p for p in user_projects if p["id"] == project.id)
    assert user_row["sbs_systems"] is None


# ---------------------------------------------------------------------------
# Pair fragment in the fragment browser: *_b fields
# ---------------------------------------------------------------------------


def test_fragment_out_exposes_pair_b_fields(admin_client, db_session):
    project = make_sbs_project(db_session)
    fragment = make_pair_fragment(db_session, project, base="sbs_0007")
    resp = admin_client.get(f"/api/project/{project.id}/fragments")
    assert resp.status_code == 200, resp.text
    item = resp.json()["items"][0]
    assert item["filename"] == "sbs_0007_a.wav"
    assert item["filename_b"] == "sbs_0007_b.wav"
    assert item["size_bytes_b"] == 1100
    assert item["duration_sec_b"] == 2.7
    assert item["audio_url"] == f"/api/media/{fragment.s3_key}"
    assert item["audio_url_b"] == f"/api/media/{fragment.s3_key_b}"


# ---------------------------------------------------------------------------
# Upload: pairs by _a/_b suffixes (session)
# ---------------------------------------------------------------------------


def make_session(client, project_id: int, files: list[dict], **kw) -> dict:
    body = {"project_id": project_id, "metadata": {}, "orig_trb": {}, "files": files}
    body.update(kw)
    resp = client.post("/api/upload/session", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def fmeta(client_id, filename, size=100, duration=2.5):
    return {"client_id": client_id, "filename": filename, "size": size, "duration": duration}


def fragments_of(db, project_id):
    db.rollback()
    return list(
        db.execute(select(AudioFragment).where(AudioFragment.project_id == project_id)).scalars()
    )


def test_session_pair_creates_single_fragment_with_swap(admin_client, db_session):
    project = create_project(admin_client, name="SBS-загрузка", consensus_overlap=2)
    info = make_session(
        admin_client, project["id"],
        [fmeta("a", "voice_a.wav"), fmeta("b", "voice_b.wav")],
    )
    sid = info["session_id"]
    # the first half is accepted — ok, but no fragment yet
    r1 = admin_client.post(f"/api/upload/session/{sid}/file/a", content=WAV)
    assert r1.status_code == 200
    assert r1.json()["ok"] is True
    assert r1.json()["fragment_id"] is None
    # the second half — ONE fragment is created
    r2 = admin_client.post(f"/api/upload/session/{sid}/file/b", content=WAV2)
    assert r2.json()["ok"] is True
    assert r2.json()["fragment_id"] is not None

    frags = fragments_of(db_session, project["id"])
    assert len(frags) == 1
    frag = frags[0]
    assert frag.filename == "voice_a.wav"
    assert frag.filename_b == "voice_b.wav"
    assert frag.size_bytes == len(WAV)
    assert frag.size_bytes_b == len(WAV2)
    assert frag.task_type == TaskType.sbs
    assert frag.orig_trb is None  # ASR is not applicable for sbs

    # K=2 sbs tasks, each has a blind order swap set (bool, not None)
    db_session.rollback()
    tasks = list(db_session.execute(select(Task).where(Task.fragment_id == frag.id)).scalars())
    assert len(tasks) == 2
    assert all(t.status == TaskStatus.open for t in tasks)
    assert all(isinstance(t.swap, bool) for t in tasks)


def test_session_unpaired_file_finishes_as_error(admin_client, db_session):
    project = create_project(admin_client, name="SBS-непарные")
    info = make_session(
        admin_client, project["id"],
        [fmeta("a", "lonely_a.wav"), fmeta("x", "nosuffix.wav")],
    )
    sid = info["session_id"]
    # lonely_a without a partner — accepted, waiting
    r1 = admin_client.post(f"/api/upload/session/{sid}/file/a", content=WAV)
    assert r1.json()["ok"] is True and r1.json()["fragment_id"] is None
    # a file without an _a/_b suffix — immediately unpaired
    rx = admin_client.post(f"/api/upload/session/{sid}/file/x", content=WAV)
    assert rx.json()["ok"] is False
    assert rx.json()["error_reason"] == "unpaired"

    # on finish the lonely half — also unpaired, no fragments
    summary = admin_client.post(f"/api/upload/session/{sid}/finish").json()
    assert summary["uploaded"] == 0
    assert {(f["client_id"], f["reason"]) for f in summary["failed"]} == {
        ("a", "unpaired"),
        ("x", "unpaired"),
    }
    assert fragments_of(db_session, project["id"]) == []


def test_session_pair_case_insensitive_suffix(admin_client, db_session):
    project = create_project(admin_client, name="SBS-регистр")
    info = make_session(
        admin_client, project["id"],
        [fmeta("a", "Clip_A.WAV"), fmeta("b", "Clip_B.wav")],
    )
    sid = info["session_id"]
    admin_client.post(f"/api/upload/session/{sid}/file/a", content=WAV)
    r2 = admin_client.post(f"/api/upload/session/{sid}/file/b", content=WAV2)
    assert r2.json()["ok"] is True
    frags = fragments_of(db_session, project["id"])
    assert len(frags) == 1
    assert frags[0].filename == "Clip_A.WAV" and frags[0].filename_b == "Clip_B.wav"


# ---------------------------------------------------------------------------
# Upload: one-step /file/batch (pairs within the batch)
# ---------------------------------------------------------------------------


def test_batch_upload_pairs(admin_client, db_session):
    project = create_project(admin_client, name="SBS-batch")
    resp = admin_client.post(
        "/api/file/batch",
        data={"project_id": str(project["id"]), "conflict": "rename"},
        files=[
            ("files", ("p1_a.wav", WAV, "audio/wav")),
            ("files", ("p1_b.wav", WAV2, "audio/wav")),
            ("files", ("lone_a.wav", WAV, "audio/wav")),  # without a partner
        ],
    )
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["task_type"] == "sbs"
    assert out["total"] == 3
    assert out["uploaded"] == 2  # both halves of a full pair
    by_name = {r["filename"]: r for r in out["results"]}
    assert by_name["p1_a.wav"]["ok"] is True
    assert by_name["p1_b.wav"]["ok"] is True
    assert by_name["p1_a.wav"]["fragment_id"] == by_name["p1_b.wav"]["fragment_id"]
    assert by_name["lone_a.wav"]["ok"] is False
    assert by_name["lone_a.wav"]["error_reason"] == "unpaired"

    frags = fragments_of(db_session, project["id"])
    assert len(frags) == 1
    assert frags[0].filename == "p1_a.wav" and frags[0].filename_b == "p1_b.wav"


# ---------------------------------------------------------------------------
# Upload: manifest filename_a/filename_b
# ---------------------------------------------------------------------------


def test_manifest_pairs_filename_a_b(admin_client, db_session):
    project = create_project(admin_client, name="SBS-манифест", consensus_overlap=2)
    manifest = (
        "filename_a,filename_b,speaker\n"
        "u1_a.wav,u1_b.wav,spk1\n"
        "u2_a.wav,u2_b.wav,spk2\n"
        "onlyA_a.wav,,spk3\n"  # no B variant → invalid
    )
    resp = admin_client.post(
        f"/api/project/{project['id']}/manifest",
        data={
            "mapping": json.dumps(
                {"filename_a": "filename_a", "filename_b": "filename_b",
                 "metadata": {"speaker": "speaker"}}
            ),
            "conflict": "reject",
        },
        files={"file": ("pairs.csv", manifest.encode())},
    )
    assert resp.status_code == 200, resp.text
    summary = resp.json()
    assert summary["task_type"] == "sbs"
    assert summary["total"] == 3
    assert summary["uploaded"] == 2
    assert [f["reason"] for f in summary["failed"]] == ["invalid_row"]

    frags = {f.filename: f for f in fragments_of(db_session, project["id"])}
    assert set(frags) == {"u1_a.wav", "u2_a.wav"}
    assert frags["u1_a.wav"].filename_b == "u1_b.wav"
    assert frags["u1_a.wav"].meta == {"speaker": "spk1"}
    # each pair row has K=2 sbs tasks with swap
    db_session.rollback()
    for frag in frags.values():
        tasks = list(
            db_session.execute(select(Task).where(Task.fragment_id == frag.id)).scalars()
        )
        assert len(tasks) == 2
        assert all(isinstance(t.swap, bool) for t in tasks)


def test_manifest_preview_suggests_pair_mapping(admin_client):
    manifest = "filename_a,filename_b,note\nx_a.wav,x_b.wav,hi\n"
    resp = admin_client.post(
        "/api/upload/manifest/preview", files={"file": ("p.csv", manifest.encode())}
    )
    assert resp.status_code == 200, resp.text
    preview = resp.json()
    mapping = preview["suggested_mapping"]
    assert mapping["filename_a"] == "filename_a"
    assert mapping["filename_b"] == "filename_b"
    assert mapping["metadata"] == {"note": "note"}
    assert preview["valid_count"] == 1
    assert preview["rows"][0]["valid"] is True


# ---------------------------------------------------------------------------
# Task.swap: randomization, payload order
# ---------------------------------------------------------------------------


def test_swap_randomized_across_tasks(admin_client, db_session):
    """The blind order is randomized: among many tasks both swap values
    occur (we create many pairs via batch and check the spread)."""
    project = create_project(admin_client, name="SBS-swap", consensus_overlap=3)
    files = []
    for i in range(12):
        files.append(("files", (f"s{i}_a.wav", WAV, "audio/wav")))
        files.append(("files", (f"s{i}_b.wav", WAV2, "audio/wav")))
    resp = admin_client.post(
        "/api/file/batch", data={"project_id": str(project["id"])}, files=files
    )
    assert resp.status_code == 200, resp.text

    db_session.rollback()
    swaps = [
        t.swap
        for t in db_session.execute(
            select(Task).join(AudioFragment, Task.fragment_id == AudioFragment.id)
            .where(AudioFragment.project_id == project["id"])
        ).scalars()
    ]
    assert len(swaps) == 12 * 3  # K=3 per pair
    assert all(isinstance(s, bool) for s in swaps)
    # both values occur (36 coin flips — the chance of otherwise is negligible)
    assert True in swaps and False in swaps


def test_payload_order_swap_false(user_client, db_session):
    # swap=False → shown option 1 = A (s3_key), 2 = B (s3_key_b)
    project = make_sbs_project(db_session)
    fragment = make_pair_fragment(db_session, project, base="ordf")
    make_task(db_session, fragment, swap=False)

    body = user_client.get("/api/task/random?task_type=sbs").json()
    assert body["type"] == "sbs"
    assert set(body["payload"]) == {"audio_url_1", "audio_url_2"}
    assert body["payload"]["audio_url_1"] == f"/api/media/{fragment.s3_key}"
    assert body["payload"]["audio_url_2"] == f"/api/media/{fragment.s3_key_b}"
    # NO system names in the payload (blind comparison)
    assert "systems" not in body["payload"]


def test_payload_order_swap_true(user_client, db_session):
    # swap=True → shown option 1 = B (s3_key_b), 2 = A (s3_key)
    project = make_sbs_project(db_session)
    fragment = make_pair_fragment(db_session, project, base="ordt")
    make_task(db_session, fragment, swap=True)

    body = user_client.get("/api/task/random?task_type=sbs").json()
    assert body["payload"]["audio_url_1"] == f"/api/media/{fragment.s3_key_b}"
    assert body["payload"]["audio_url_2"] == f"/api/media/{fragment.s3_key}"


# ---------------------------------------------------------------------------
# Submit: preference normalization by swap, validation
# ---------------------------------------------------------------------------


def _submit(user_client, task_id, extra):
    return user_client.post(
        f"/api/task/{task_id}/submit", json={"task_id": task_id, "type": "sbs", **extra}
    )


def test_submit_normalizes_preference_swap_false(user_client, db_session):
    project = make_sbs_project(db_session)
    fragment = make_pair_fragment(db_session, project, base="nf")
    make_task(db_session, fragment, swap=False)
    task_id = user_client.get("/api/task/random?task_type=sbs").json()["id"]

    # swap=False: shown order = system terms → sign is preserved
    resp = _submit(user_client, task_id, {"preference": -2})
    assert resp.status_code == 200, resp.text
    db_session.expire_all()
    task = db_session.get(Task, task_id)
    assert task.status == TaskStatus.done
    assert task.result == {"type": "sbs", "preference": -2}  # A is much better


def test_submit_normalizes_preference_swap_true(user_client, db_session):
    project = make_sbs_project(db_session)
    fragment = make_pair_fragment(db_session, project, base="nt")
    make_task(db_session, fragment, swap=True)
    task_id = user_client.get("/api/task/random?task_type=sbs").json()["id"]

    # contract: +2 with swap=True → A is better → -2 in result (system terms)
    resp = _submit(user_client, task_id, {"preference": 2})
    assert resp.status_code == 200, resp.text
    db_session.expire_all()
    assert db_session.get(Task, task_id).result["preference"] == -2


def test_submit_preference_zero_stable(user_client, db_session):
    project = make_sbs_project(db_session)
    fragment = make_pair_fragment(db_session, project, base="eq")
    make_task(db_session, fragment, swap=True)
    task_id = user_client.get("/api/task/random?task_type=sbs").json()["id"]
    resp = _submit(user_client, task_id, {"preference": 0})
    assert resp.status_code == 200
    db_session.expire_all()
    assert db_session.get(Task, task_id).result["preference"] == 0  # -0 == 0


def test_submit_integer_float_preference(user_client, db_session):
    project = make_sbs_project(db_session)
    fragment = make_pair_fragment(db_session, project, base="fl")
    make_task(db_session, fragment, swap=False)
    task_id = user_client.get("/api/task/random?task_type=sbs").json()["id"]
    resp = _submit(user_client, task_id, {"preference": 1.0})
    assert resp.status_code == 200, resp.text
    db_session.expire_all()
    assert db_session.get(Task, task_id).result["preference"] == 1


@pytest.mark.parametrize(
    "bad",
    [
        {"preference": 3},       # > 2
        {"preference": -3},      # < -2
        {"preference": "1"},     # string
        {"preference": 1.5},     # fraction
        {"preference": True},    # bool
        {"preference": None},    # null
        {},                      # no preference
    ],
)
def test_submit_bad_preference_422(user_client, db_session, bad):
    project = make_sbs_project(db_session)
    fragment = make_pair_fragment(db_session, project, base="bad")
    make_task(db_session, fragment, swap=False)
    task_id = user_client.get("/api/task/random?task_type=sbs").json()["id"]
    resp = _submit(user_client, task_id, bad)
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == "bad_result"
    db_session.expire_all()
    assert db_session.get(Task, task_id).status == TaskStatus.in_progress


# ---------------------------------------------------------------------------
# Consensus on the normalized result
# ---------------------------------------------------------------------------


def test_consensus_majority_on_normalized_preference(admin_client, db_session, regular_user):
    """Two different swap tasks with the same normalized preference
    agree 100% (result is stored in system terms)."""
    project = make_sbs_project(db_session)
    fragment = make_pair_fragment(db_session, project, base="cons")
    other = make_user(db_session, "sbs-second")
    now = utcnow()
    # both done tasks store the normalized preference=-1 (A is better), swap differs
    db_session.add_all([
        Task(fragment_id=fragment.id, user_id=regular_user.id, status=TaskStatus.done,
             swap=False, result={"type": "sbs", "preference": -1},
             started_at=now, finished_at=now),
        Task(fragment_id=fragment.id, user_id=other.id, status=TaskStatus.done,
             swap=True, result={"type": "sbs", "preference": -1},
             started_at=now, finished_at=now),
    ])
    db_session.commit()

    resp = admin_client.get(f"/api/project/{project.id}/agreement")
    assert resp.status_code == 200
    assert resp.json()["avg_agreement_pct"] == 100.0


# ---------------------------------------------------------------------------
# Export jsonl/csv; tabular-only formats
# ---------------------------------------------------------------------------


@pytest.fixture()
def sbs_dataset(db_session, regular_user):
    project = Project(
        name="Сравнение TTS-движков", task_type=TaskType.sbs, label_list=[],
        sbs_systems=CUSTOM_SYSTEMS,
    )
    db_session.add(project)
    db_session.flush()
    fragment = AudioFragment(
        project_id=project.id, filename="pair_a.wav", s3_key="audio/pair_a.wav",
        size_bytes=1000, duration_sec=4.0,
        filename_b="pair_b.wav", s3_key_b="audio/pair_b.wav",
        size_bytes_b=1100, duration_sec_b=4.2,
        task_type=TaskType.sbs, meta={"batch": "seed"},
    )
    db_session.add(fragment)
    db_session.flush()
    db_session.add(
        Task(fragment_id=fragment.id, user_id=regular_user.id, status=TaskStatus.done,
             swap=False, result={"type": "sbs", "preference": 2}, finished_at=utcnow())
    )
    db_session.commit()
    return SimpleNamespace(project=project)


def _read_targz(data):
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        return {m.name: tar.extractfile(m).read().decode("utf-8")
                for m in tar.getmembers() if m.isfile()}


def _read_zip(data):
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return {name: zf.read(name).decode("utf-8") for name in zf.namelist()}


def _export(admin_client, project_id, fmt, include_metadata=False):
    body = {"format": fmt, "scope": "consensus", "include_metadata": include_metadata}
    resp = admin_client.post(f"/api/project/{project_id}/export", json=body)
    assert resp.status_code == 202, resp.text
    job = resp.json()
    done = admin_client.get(f"/api/export/{job['id']}").json()
    assert done["status"] == "done", done
    return admin_client.get(done["download_url"]).content


def test_export_jsonl_sbs(admin_client, sbs_dataset):
    data = _export(admin_client, sbs_dataset.project.id, "jsonl")
    rows = [json.loads(line) for line in _read_targz(data)["dataset.jsonl"].splitlines()]
    assert len(rows) == 1
    row = rows[0]
    assert row["audio"] == "pair_a.wav"
    assert row["audio_b"] == "pair_b.wav"
    assert row["preference"] == 2  # B is better (system terms)
    assert row["systems"] == CUSTOM_SYSTEMS
    assert row["task_type"] == "sbs"


def test_export_csv_sbs(admin_client, sbs_dataset):
    data = _export(admin_client, sbs_dataset.project.id, "csv")
    text = _read_zip(data)["dataset.csv"]
    rows = list(csv_lib.reader(io.StringIO(text)))
    header, body = rows[0], rows[1:]
    assert "audio_b" in header and "sbs_preference" in header
    row = body[0]
    assert row[header.index("audio_b")] == "pair_b.wav"
    assert row[header.index("sbs_preference")] == "2"
    assert row[header.index("task_type")] == "sbs"


@pytest.mark.parametrize("fmt", ["nemo", "textgrid", "conll", "srt_vtt"])
def test_export_sbs_format_not_applicable(admin_client, sbs_dataset, fmt):
    resp = admin_client.post(
        f"/api/project/{sbs_dataset.project.id}/export",
        json={"format": fmt, "scope": "consensus"},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "format_not_applicable"
