"""Tests for annotator tasks: /task/random (filters, permissions, zombies),
submit, skip, history. Response shapes — src/api/types.ts (Task, TaskHistoryItem,
Paginated)."""

import uuid
from datetime import timedelta

from sqlalchemy import select

from src.auth import hash_password
from src.models import (
    AudioFragment,
    Project,
    Task,
    TaskStatus,
    TaskType,
    User,
    UserRole,
    utcnow,
)
from src.routers.task import ZOMBIE_RELEASE_HOURS
from tests.conftest import USER_PASSWORD, login_as

# ---------------------------------------------------------------------------
# DB-seeding helpers
# ---------------------------------------------------------------------------

LABELS = [{"name": "речь", "color": "#D9D4F7"}, {"name": "музыка", "color": "#F2A9A9"}]


def make_project(
    db,
    name="Радио-архив 2024",
    instruction="Слушайте внимательно",
    task_type=TaskType.transcription,
) -> Project:
    project = Project(
        name=name, description="", instruction=instruction, label_list=LABELS,
        task_type=task_type,
    )
    db.add(project)
    # /task/random gives tasks only to project participants — the test project
    # includes all users existing at this moment
    project.participants = list(db.execute(select(User)).scalars())
    db.commit()
    db.refresh(project)
    return project


def make_fragment(
    db, project, filename="a.wav", task_type=TaskType.transcription, orig_trb=None
) -> AudioFragment:
    fragment = AudioFragment(
        project_id=project.id,
        filename=filename,
        s3_key=f"p{project.id}/{uuid.uuid4().hex}-{filename}",
        size_bytes=1024,
        duration_sec=2.5,
        task_type=task_type,
        orig_trb=orig_trb,
        meta={"source": "radio"},
    )
    db.add(fragment)
    db.commit()
    db.refresh(fragment)
    return fragment


def make_task(db, fragment, status=TaskStatus.open, user_id=None, **kw) -> Task:
    task = Task(fragment_id=fragment.id, status=status, user_id=user_id, **kw)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def make_user(db, login, permissions=None, fio=None) -> User:
    user = User(
        login=login,
        password_hash=hash_password(USER_PASSWORD),
        fio=fio or login.title(),
        role=UserRole.user,
        permissions=permissions or {},
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# GET /task/random
# ---------------------------------------------------------------------------


def test_random_requires_auth(client):
    assert client.get("/api/task/random").status_code == 401


def test_random_assigns_open_task(user_client, regular_user, db_session):
    project = make_project(db_session)
    fragment = make_fragment(db_session, project, orig_trb="аср-черновик")
    task = make_task(db_session, fragment)

    resp = user_client.get("/api/task/random")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Response shape — types.ts Task
    assert set(body) == {
        "id", "project_id", "project_name", "fragment", "instruction", "type", "payload",
    }
    assert body["id"] == task.id
    assert body["project_id"] == project.id
    assert body["project_name"] == project.name
    assert body["instruction"] == "Слушайте внимательно"
    assert body["type"] == "transcription"
    assert body["payload"] == {"orig_trb": "аср-черновик"}

    # Fragment shape — types.ts AudioFragment
    frag = body["fragment"]
    assert set(frag) == {
        "id", "project_id", "filename", "duration_sec", "size_bytes", "task_type",
        "orig_trb", "metadata", "finished", "task_count", "tasks_done",
        "tasks_required", "audio_url", "source_id",
    }
    assert frag["id"] == fragment.id
    assert frag["metadata"] == {"source": "radio"}
    assert frag["finished"] is False
    assert frag["task_count"] == 0
    assert frag["tasks_done"] == 0
    assert frag["tasks_required"] == 1  # the project's consensus_overlap by default
    assert frag["audio_url"] == f"/api/media/{fragment.s3_key}"

    # Task grabbed: in_progress, user_id, started_at
    db_session.expire_all()
    taken = db_session.get(Task, task.id)
    assert taken.status == TaskStatus.in_progress
    assert taken.user_id == regular_user.id
    assert taken.started_at is not None


def test_random_repeated_returns_same_in_progress(user_client, db_session):
    project = make_project(db_session)
    make_task(db_session, make_fragment(db_session, project, "a.wav"))
    make_task(db_session, make_fragment(db_session, project, "b.wav"))

    first = user_client.get("/api/task/random").json()
    second = user_client.get("/api/task/random").json()
    assert first["id"] == second["id"]


def test_random_filters_project_and_type(user_client, db_session):
    project_a = make_project(db_session, "Проект А")
    project_b = make_project(db_session, "Проект Б")
    make_task(db_session, make_fragment(db_session, project_a, "a.wav", TaskType.transcription))
    make_task(db_session, make_fragment(db_session, project_b, "b.wav", TaskType.segmentation))

    resp = user_client.get(f"/api/task/random?project_id={project_b.id}")
    assert resp.status_code == 200
    assert resp.json()["fragment"]["project_id"] == project_b.id
    assert resp.json()["type"] == "segmentation"

    resp = user_client.get("/api/task/random?task_type=transcription")
    assert resp.status_code == 200
    assert resp.json()["type"] == "transcription"

    resp = user_client.get("/api/task/random?task_type=diarization")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "no_tasks_available"


def test_random_excludes_fragment_done_by_user(user_client, regular_user, db_session):
    project_a = make_project(db_session, "Проект А")
    project_b = make_project(db_session, "Проект Б")
    done_fragment = make_fragment(db_session, project_a, "done.wav")
    make_task(
        db_session, done_fragment, status=TaskStatus.done, user_id=regular_user.id,
        started_at=utcnow(), finished_at=utcnow(), result={"text": "готово"},
    )
    make_task(db_session, done_fragment)  # an open task on the submitted fragment
    other = make_fragment(db_session, project_b, "other.wav")
    other_task = make_task(db_session, other)

    # The only valid candidate — a fragment without the user's done task
    resp = user_client.get("/api/task/random")
    assert resp.status_code == 200
    assert resp.json()["id"] == other_task.id

    # Within the project where everything is submitted, there are no tasks
    user_client.post(f"/api/task/{other_task.id}/skip")
    resp = user_client.get(f"/api/task/random?project_id={project_a.id}")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "no_tasks_available"


def test_random_respects_permission_block(client, db_session):
    project = make_project(db_session)
    make_task(db_session, make_fragment(db_session, project, "c.wav", TaskType.classification))
    make_task(db_session, make_fragment(db_session, project, "t.wav", TaskType.transcription))
    blocked_user = make_user(db_session, "blocked", permissions={"classification": "admin_block"})
    # the user is created after the project — add to participants (otherwise 404 by membership)
    project.participants.append(blocked_user)
    db_session.commit()
    login_as(client, "blocked", USER_PASSWORD)

    # classification blocked by admin_block — only transcription is given
    resp = client.get("/api/task/random")
    assert resp.status_code == 200
    assert resp.json()["type"] == "transcription"

    # Explicit request for the blocked type — no tasks
    resp = client.get("/api/task/random?task_type=classification")
    assert resp.status_code == 404


def test_random_user_block_also_excludes(client, db_session):
    project = make_project(db_session)
    make_task(db_session, make_fragment(db_session, project, "s.wav", TaskType.segmentation))
    selfblock_user = make_user(db_session, "selfblock", permissions={"segmentation": "user_block"})
    # a project participant, but the type is blocked — 404 exactly because of the block
    project.participants.append(selfblock_user)
    db_session.commit()
    login_as(client, "selfblock", USER_PASSWORD)

    assert client.get("/api/task/random").status_code == 404


def test_random_releases_zombies(user_client, regular_user, db_session):
    project = make_project(db_session)
    other = make_user(db_session, "zombie-holder")
    fragment = make_fragment(db_session, project)
    stuck = make_task(
        db_session, fragment, status=TaskStatus.in_progress, user_id=other.id,
        started_at=utcnow() - timedelta(hours=ZOMBIE_RELEASE_HOURS + 1),
    )

    resp = user_client.get("/api/task/random")
    assert resp.status_code == 200
    assert resp.json()["id"] == stuck.id

    db_session.expire_all()
    reissued = db_session.get(Task, stuck.id)
    assert reissued.status == TaskStatus.in_progress
    assert reissued.user_id == regular_user.id


def test_random_keeps_fresh_in_progress(user_client, db_session):
    project = make_project(db_session)
    other = make_user(db_session, "fresh-holder")
    make_task(
        db_session, make_fragment(db_session, project), status=TaskStatus.in_progress,
        user_id=other.id, started_at=utcnow() - timedelta(hours=1),
    )

    # A fresh in_progress of another user is not taken away
    assert user_client.get("/api/task/random").status_code == 404


def test_verification_payload(user_client, db_session):
    project = make_project(db_session)
    author = make_user(db_session, "author", fio="Петров Пётр")
    fragment = make_fragment(
        db_session, project, "v.wav", TaskType.verification, orig_trb="черновик"
    )
    make_task(
        db_session, fragment, status=TaskStatus.done, user_id=author.id,
        started_at=utcnow(), finished_at=utcnow(), result={"text": "сданный текст"},
    )
    make_task(db_session, fragment)

    resp = user_client.get("/api/task/random?task_type=verification")
    assert resp.status_code == 200
    assert resp.json()["payload"] == {"text": "сданный текст", "author_fio": "Петров Пётр"}


def test_classification_payload_labels(user_client, db_session):
    project = make_project(db_session)
    make_task(db_session, make_fragment(db_session, project, "c.wav", TaskType.classification))

    resp = user_client.get("/api/task/random?task_type=classification")
    assert resp.status_code == 200
    assert resp.json()["payload"] == {"labels": LABELS, "multiple": False}


# ---------------------------------------------------------------------------
# MOS rating (6th task type): random → project scales payload → submit {scores}
# ---------------------------------------------------------------------------


def test_mos_workflow_random_and_submit(user_client, regular_user, db_session):
    # project without explicit mos_scales → effective default scale
    project = make_project(db_session, "Оценка синтеза TTS", task_type=TaskType.mos)
    fragment = make_fragment(db_session, project, "tts.wav", TaskType.mos)
    make_task(db_session, fragment)

    # filter by mos type works, payload — scale 1..5 + the project's scales
    resp = user_client.get("/api/task/random?task_type=mos")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["type"] == "mos"
    assert body["fragment"]["task_type"] == "mos"
    assert body["payload"] == {
        "scale_min": 1,
        "scale_max": 5,
        "mos_scales": [{"name": "Качество звучания"}],
    }

    # submit result {scores: {scale_name: 1..5}} over all the project's scales
    task_id = body["id"]
    resp = user_client.post(
        f"/api/task/{task_id}/submit",
        json={"task_id": task_id, "type": "mos", "scores": {"Качество звучания": 4}},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "task_id": task_id}

    db_session.expire_all()
    task = db_session.get(Task, task_id)
    assert task.status == TaskStatus.done
    assert task.result == {"type": "mos", "scores": {"Качество звучания": 4}}

    # the submitted mos task is visible in history
    history = user_client.get("/api/task/history").json()
    assert history["total"] == 1
    assert history["items"][0]["task_type"] == "mos"


def test_mos_submit_type_mismatch(user_client, db_session):
    # the type in the submit is checked against the fragment type
    project = make_project(db_session, task_type=TaskType.mos)
    make_task(db_session, make_fragment(db_session, project, "tts.wav", TaskType.mos))
    task_id = user_client.get("/api/task/random").json()["id"]

    resp = user_client.post(
        f"/api/task/{task_id}/submit",
        json={"task_id": task_id, "type": "transcription", "text": "не то"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "task_type_mismatch"


def test_random_respects_mos_permission_block(client, db_session):
    # the permissions matrix covers the 6th type: mos with admin_block is not given
    project = make_project(db_session, task_type=TaskType.mos)
    make_task(db_session, make_fragment(db_session, project, "tts.wav", TaskType.mos))
    make_user(db_session, "mos-blocked", permissions={"mos": "admin_block"})
    login_as(client, "mos-blocked", USER_PASSWORD)

    assert client.get("/api/task/random").status_code == 404
    assert client.get("/api/task/random?task_type=mos").status_code == 404


# ---------------------------------------------------------------------------
# POST /task/{id}/submit
# ---------------------------------------------------------------------------


def test_submit_flow(user_client, regular_user, db_session):
    project = make_project(db_session)
    make_task(db_session, make_fragment(db_session, project))
    task_id = user_client.get("/api/task/random").json()["id"]

    resp = user_client.post(
        f"/api/task/{task_id}/submit",
        json={"task_id": task_id, "type": "transcription", "text": "привет мир"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "task_id": task_id}

    db_session.expire_all()
    task = db_session.get(Task, task_id)
    assert task.status == TaskStatus.done
    assert task.finished_at is not None
    assert task.result["text"] == "привет мир"
    assert task.result["type"] == "transcription"

    # Re-submitting the same task — conflict
    resp = user_client.post(
        f"/api/task/{task_id}/submit", json={"task_id": task_id, "text": "ещё раз"}
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "task_not_in_progress"


def test_submit_task_id_mismatch(user_client, db_session):
    project = make_project(db_session)
    make_task(db_session, make_fragment(db_session, project))
    task_id = user_client.get("/api/task/random").json()["id"]

    resp = user_client.post(f"/api/task/{task_id}/submit", json={"task_id": task_id + 1})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "task_id_mismatch"


def test_submit_foreign_task_forbidden(user_client, db_session):
    project = make_project(db_session)
    other = make_user(db_session, "someone")
    foreign = make_task(
        db_session, make_fragment(db_session, project), status=TaskStatus.in_progress,
        user_id=other.id, started_at=utcnow(),
    )

    resp = user_client.post(
        f"/api/task/{foreign.id}/submit", json={"task_id": foreign.id, "text": "чужое"}
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "not_your_task"


def test_submit_not_found(user_client):
    resp = user_client.post("/api/task/999/submit", json={"task_id": 999})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "task_not_found"


# ---------------------------------------------------------------------------
# POST /task/{id}/skip
# ---------------------------------------------------------------------------


def test_skip_releases_task(user_client, db_session):
    project = make_project(db_session)
    make_task(db_session, make_fragment(db_session, project))
    task_id = user_client.get("/api/task/random").json()["id"]

    resp = user_client.post(f"/api/task/{task_id}/skip")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "task_id": task_id}

    db_session.expire_all()
    task = db_session.get(Task, task_id)
    assert task.status == TaskStatus.skipped
    assert task.user_id is None

    # The skipped task returns to the pool and is given out again
    resp = user_client.get("/api/task/random")
    assert resp.status_code == 200
    assert resp.json()["id"] == task_id


def test_skip_foreign_task_forbidden(user_client, db_session):
    project = make_project(db_session)
    other = make_user(db_session, "keeper")
    foreign = make_task(
        db_session, make_fragment(db_session, project), status=TaskStatus.in_progress,
        user_id=other.id, started_at=utcnow(),
    )

    assert user_client.post(f"/api/task/{foreign.id}/skip").status_code == 403


# ---------------------------------------------------------------------------
# GET /task/history
# ---------------------------------------------------------------------------


def test_history_shape_and_pagination(user_client, regular_user, db_session):
    project = make_project(db_session, "Колл-центр Q2")
    base = utcnow()
    for i in range(3):
        fragment = make_fragment(db_session, project, f"h{i}.wav")
        make_task(
            db_session, fragment, status=TaskStatus.done, user_id=regular_user.id,
            started_at=base - timedelta(minutes=10 + i), finished_at=base - timedelta(minutes=i),
            result={"text": f"т{i}"},
        )
    # Another user's submitted task does not appear in history
    other = make_user(db_session, "colleague")
    make_task(
        db_session, make_fragment(db_session, project, "x.wav"), status=TaskStatus.done,
        user_id=other.id, started_at=base, finished_at=base, result={},
    )

    resp = user_client.get("/api/task/history?offset=0&limit=2")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"items", "total", "offset", "limit"}
    assert body["total"] == 3
    assert body["offset"] == 0
    assert body["limit"] == 2
    assert len(body["items"]) == 2

    # Shape — types.ts TaskHistoryItem; newest first
    item = body["items"][0]
    assert set(item) == {
        "task_id", "task_type", "project_id", "project_name",
        "fragment_filename", "submitted_at", "status",
    }
    assert item["fragment_filename"] == "h0.wav"
    assert item["project_name"] == "Колл-центр Q2"
    assert item["task_type"] == "transcription"
    assert item["status"] in {"accepted", "pending", "consensus"}

    resp = user_client.get("/api/task/history?offset=2&limit=2")
    body = resp.json()
    assert body["total"] == 3
    assert len(body["items"]) == 1
    assert body["items"][0]["fragment_filename"] == "h2.wav"


def test_history_empty(user_client):
    resp = user_client.get("/api/task/history")
    assert resp.status_code == 200
    assert resp.json() == {"items": [], "total": 0, "offset": 0, "limit": 10}


def test_history_requires_auth(client):
    assert client.get("/api/task/history").status_code == 401


def test_random_only_for_project_participants(client, db_session):
    """An annotator gets tasks only from THEIR projects (where they are a participant)."""
    project = make_project(db_session)
    make_task(db_session, make_fragment(db_session, project, "p.wav"))

    outsider = make_user(db_session, "outsider")
    login_as(client, "outsider", USER_PASSWORD)

    # Not a participant — no tasks, even with an explicit project_id
    assert client.get("/api/task/random").status_code == 404
    assert client.get(f"/api/task/random?project_id={project.id}").status_code == 404

    # Became a participant — a task is given out
    project.participants.append(outsider)
    db_session.commit()
    resp = client.get("/api/task/random")
    assert resp.status_code == 200
    assert resp.json()["project_id"] == project.id
