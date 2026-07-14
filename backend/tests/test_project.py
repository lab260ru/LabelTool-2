"""Tests for project CRUD, fragments, aggregates and the instruction.

Data fixture: a project with 5 fragments and tasks, including a zombie task
(in_progress older than 24 h) and pairs of done tasks for agreement metrics.
"""

from datetime import timedelta

import pytest

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

# ---------------------------------------------------------------------------
# Data fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def project(db_session) -> Project:
    p = Project(
        name="Радио-архив 2024",
        description="Записи эфиров",
        instruction="Слушайте внимательно и размечайте по инструкции.",
        label_list=[{"name": "речь", "color": "#D9D4F7"}, {"name": "музыка", "color": "#E8604C"}],
        task_type=TaskType.transcription,
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


def _annotator(db, login: str, fio: str, group: str | None = None) -> User:
    user = User(
        login=login, password_hash="x", fio=fio, role=UserRole.user, group_name=group
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def annotators(db_session) -> tuple[User, User]:
    u1 = _annotator(db_session, "ann1", "Первый Разметчик", "БВТ2101")
    u2 = _annotator(db_session, "ann2", "Второй Разметчик", "БВТ2102")
    return u1, u2


@pytest.fixture()
def fragments(db_session, project, annotators) -> list[AudioFragment]:
    """5 fragments:
    f1 transcription — 2 done with the SAME result (labeled, agreement 100);
    f2 transcription — 2 done with DIFFERENT result (labeled, agreement 50);
    f3 classification — in_progress just now (in progress);
    f4 classification — in_progress 30 h ago (in progress + ZOMBIE);
    f5 segmentation — no tasks (open).
    """
    u1, u2 = annotators

    def frag(i: int, task_type: TaskType) -> AudioFragment:
        f = AudioFragment(
            project_id=project.id,
            filename=f"radio_{i:04d}.wav",
            s3_key=f"project_{project.id}/radio_{i:04d}.wav",
            size_bytes=1000 + i,
            duration_sec=2.5 if i != 5 else None,
            task_type=task_type,
            orig_trb="черновик" if i == 1 else None,
            meta={"source": "radio"},
        )
        db_session.add(f)
        return f

    f1 = frag(1, TaskType.transcription)
    f2 = frag(2, TaskType.transcription)
    f3 = frag(3, TaskType.classification)
    f4 = frag(4, TaskType.classification)
    f5 = frag(5, TaskType.segmentation)
    db_session.commit()
    for f in (f1, f2, f3, f4, f5):
        db_session.refresh(f)

    now = utcnow()
    db_session.add_all(
        [
            Task(
                fragment_id=f1.id, user_id=u1.id, status=TaskStatus.done,
                result={"text": "привет"}, started_at=now, finished_at=now,
            ),
            Task(
                fragment_id=f1.id, user_id=u2.id, status=TaskStatus.done,
                result={"text": "привет"}, started_at=now, finished_at=now,
            ),
            Task(
                fragment_id=f2.id, user_id=u1.id, status=TaskStatus.done,
                result={"text": "аа"}, started_at=now, finished_at=now,
            ),
            Task(
                fragment_id=f2.id, user_id=u2.id, status=TaskStatus.done,
                result={"text": "бб"}, started_at=now, finished_at=now,
            ),
            Task(
                fragment_id=f3.id, user_id=u1.id, status=TaskStatus.in_progress,
                started_at=now,
            ),
            # zombie: in_progress older than 24 h
            Task(
                fragment_id=f4.id, user_id=u2.id, status=TaskStatus.in_progress,
                started_at=now - timedelta(hours=30),
            ),
        ]
    )
    db_session.commit()
    return [f1, f2, f3, f4, f5]


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


def test_projects_require_auth(client):
    assert client.get("/api/projects").status_code == 401


def test_user_cannot_create_project(user_client):
    resp = user_client.post("/api/projects", json={"name": "Нельзя"})
    assert resp.status_code == 403


def test_user_lists_only_own_projects(user_client, regular_user, project, db_session):
    # The annotator sees the list (the hub picks a project for the instruction),
    # but only THEIR projects: not a participant — the list is empty
    resp = user_client.get("/api/projects")
    assert resp.status_code == 200
    assert resp.json() == []

    # Became a participant — the project appeared in the list
    project.participants.append(regular_user)
    db_session.commit()
    resp = user_client.get("/api/projects")
    assert resp.status_code == 200
    assert [p["id"] for p in resp.json()] == [project.id]


def test_user_cannot_browse_fragments_or_progress(user_client, project):
    assert user_client.get(f"/api/project/{project.id}/fragments").status_code == 403
    assert user_client.get(f"/api/project/{project.id}/progress").status_code == 403


# ---------------------------------------------------------------------------
# Project CRUD
# ---------------------------------------------------------------------------


def test_create_project(admin_client, regular_user):
    resp = admin_client.post(
        "/api/projects",
        json={
            "name": "Колл-центр Q2",
            "description": "Звонки",
            "instruction": "Транскрибируйте дословно",
            "task_type": "classification",
            "label_list": [{"name": "шум", "color": "#8A8F98"}],
            "participants": [regular_user.id],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "Колл-центр Q2"
    assert body["description"] == "Звонки"
    assert body["instruction"] == "Транскрибируйте дословно"
    assert body["task_type"] == "classification"
    assert body["label_list"] == [{"name": "шум", "color": "#8A8F98"}]
    assert body["participants"] == [
        {"user_id": regular_user.id, "fio": regular_user.fio, "group": "БВТ2101"}
    ]
    assert body["task_types"] == []
    assert body["counters"] == {
        "fragments_total": 0,
        "fragments_labeled": 0,
        "fragments_in_progress": 0,
        "zombie_tasks": 0,
        "progress_pct": 0,
    }
    assert "created_at" in body


def test_create_project_requires_name(admin_client):
    assert admin_client.post("/api/projects", json={}).status_code == 400
    resp = admin_client.post("/api/projects", json={"name": "   "})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "name_required"


def test_create_project_requires_task_type(admin_client):
    # task type is required on creation (model change: type on the project)
    resp = admin_client.post("/api/projects", json={"name": "Без типа"})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "task_type_required"

    # invalid value is rejected by the schema
    resp = admin_client.post("/api/projects", json={"name": "X", "task_type": "nope"})
    assert resp.status_code == 422


def test_create_mos_project(admin_client):
    # 6th task type: MOS rating
    resp = admin_client.post(
        "/api/projects", json={"name": "Оценка синтеза TTS", "task_type": "mos"}
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["task_type"] == "mos"


def test_create_project_unknown_participant(admin_client):
    resp = admin_client.post(
        "/api/projects",
        json={"name": "X", "task_type": "transcription", "participants": [999]},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "user_not_found"


def test_get_project_and_404(admin_client, project):
    resp = admin_client.get(f"/api/project/{project.id}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Радио-архив 2024"
    assert admin_client.get("/api/project/9999").status_code == 404


def test_list_projects_with_aggregates(admin_client, project, fragments):
    resp = admin_client.get("/api/projects")
    assert resp.status_code == 200
    projects = resp.json()
    assert len(projects) == 1
    p = projects[0]
    assert p["id"] == project.id
    assert p["task_type"] == "transcription"
    # derived list of fragment types (legacy: the fixture is mixed-type)
    assert p["task_types"] == ["transcription", "classification", "segmentation"]
    assert p["counters"] == {
        "fragments_total": 5,
        "fragments_labeled": 2,        # f1, f2 — have done tasks
        "fragments_in_progress": 2,    # f3, f4 — in_progress without done
        "zombie_tasks": 1,             # f4 — in_progress older than 24 h
        "progress_pct": 40,            # 2/5
    }


def test_patch_project(admin_client, project, regular_user, annotators):
    u1, u2 = annotators
    resp = admin_client.patch(
        f"/api/project/{project.id}",
        json={
            "name": "Радио-архив 2025",
            "instruction": "Новая инструкция",
            "label_list": [{"name": "тишина", "color": "#B9AFF2"}],
            "participants": [u1.id],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "Радио-архив 2025"
    assert body["instruction"] == "Новая инструкция"
    assert body["label_list"] == [{"name": "тишина", "color": "#B9AFF2"}]
    assert [p["user_id"] for p in body["participants"]] == [u1.id]
    # description not touched
    assert body["description"] == "Записи эфиров"

    # participants as {user_id} objects (client.ts update sends ProjectParticipant[])
    resp = admin_client.patch(
        f"/api/project/{project.id}",
        json={"participants": [{"user_id": u2.id, "fio": "игнор", "group": None}]},
    )
    assert resp.status_code == 200
    assert [p["user_id"] for p in resp.json()["participants"]] == [u2.id]

    # adding whole groups at once
    resp = admin_client.patch(
        f"/api/project/{project.id}",
        json={"participants": [], "participant_groups": ["БВТ2101"]},
    )
    assert resp.status_code == 200
    got = {p["user_id"] for p in resp.json()["participants"]}
    assert got == {regular_user.id, u1.id}  # both from БВТ2101

    assert admin_client.patch("/api/project/9999", json={"name": "x"}).status_code == 404


def test_patch_project_task_type_while_empty(admin_client, project):
    # while there are no fragments — the type can be changed
    resp = admin_client.patch(f"/api/project/{project.id}", json={"task_type": "mos"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["task_type"] == "mos"


def test_patch_project_task_type_with_fragments_409(admin_client, project, fragments):
    # fragments already inherited the type — changing is forbidden
    resp = admin_client.patch(f"/api/project/{project.id}", json={"task_type": "mos"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "project_has_fragments"

    # repeating the current value — no-op, not 409
    resp = admin_client.patch(
        f"/api/project/{project.id}", json={"task_type": "transcription"}
    )
    assert resp.status_code == 200
    assert resp.json()["task_type"] == "transcription"


def test_delete_project(admin_client, db_session, project, fragments):
    resp = admin_client.delete(f"/api/project/{project.id}")
    assert resp.status_code == 204
    assert admin_client.get(f"/api/project/{project.id}").status_code == 404
    # fragments removed by cascade
    db_session.expire_all()
    assert db_session.query(AudioFragment).count() == 0


# ---------------------------------------------------------------------------
# Instruction (public read by an annotator)
# ---------------------------------------------------------------------------


def test_instruction_readable_by_user(user_client, project):
    resp = user_client.get(f"/api/project/{project.id}/instruction")
    assert resp.status_code == 200
    assert resp.json() == {
        "project_id": project.id,
        "instruction": "Слушайте внимательно и размечайте по инструкции.",
    }


def test_instruction_404_and_auth(client, user_client):
    assert user_client.get("/api/project/9999/instruction").status_code == 404
    # without auth — 401 (user_client and client share a cookie, we log out)
    client.post("/api/auth/logout")
    client.cookies.clear()
    assert client.get("/api/project/1/instruction").status_code == 401


# ---------------------------------------------------------------------------
# Fragment browser
# ---------------------------------------------------------------------------


def test_fragments_pagination_and_shape(admin_client, project, fragments):
    resp = admin_client.get(f"/api/project/{project.id}/fragments?offset=0&limit=2")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 5
    assert body["offset"] == 0
    assert body["limit"] == 2
    assert len(body["items"]) == 2

    first = body["items"][0]
    assert first["filename"] == "radio_0001.wav"
    assert first["project_id"] == project.id
    assert first["task_type"] == "transcription"
    assert first["finished"] is True
    assert first["task_count"] == 2
    # consensus progress: done / the project's consensus_overlap (default 1)
    assert first["tasks_done"] == 2
    assert first["tasks_required"] == 1
    assert first["orig_trb"] == "черновик"
    assert first["metadata"] == {"source": "radio"}
    assert first["duration_sec"] == 2.5
    # presigned URL of local storage
    assert first["audio_url"] == f"/api/media/project_{project.id}/radio_0001.wav"

    # last page
    resp = admin_client.get(f"/api/project/{project.id}/fragments?offset=4&limit=2")
    tail = resp.json()
    assert tail["total"] == 5
    assert len(tail["items"]) == 1
    assert tail["items"][0]["filename"] == "radio_0005.wav"
    assert tail["items"][0]["finished"] is False
    assert tail["items"][0]["task_count"] == 0
    assert tail["items"][0]["duration_sec"] is None

    assert admin_client.get("/api/project/9999/fragments").status_code == 404


def test_fragments_filters(admin_client, project, fragments):
    base = f"/api/project/{project.id}/fragments"

    resp = admin_client.get(base, params={"task_type": "transcription"})
    assert [f["filename"] for f in resp.json()["items"]] == [
        "radio_0001.wav", "radio_0002.wav",
    ]

    resp = admin_client.get(base, params={"finished": "true"})
    assert resp.json()["total"] == 2

    resp = admin_client.get(base, params={"finished": "false"})
    assert resp.json()["total"] == 3

    resp = admin_client.get(base, params={"search": "0003"})
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["filename"] == "radio_0003.wav"

    # invalid task type is rejected by validation
    assert admin_client.get(base, params={"task_type": "nope"}).status_code == 422


def test_patch_fragment_task_type_ignored(admin_client, fragments):
    # Fragment type change removed: the type is single per project, the field is ignored
    f5 = fragments[4]  # segmentation
    resp = admin_client.patch(f"/api/fragment/{f5.id}", json={"task_type": "diarization"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == f5.id
    assert body["task_type"] == "segmentation"  # unchanged

    # a garbage value is still rejected by the schema
    assert (
        admin_client.patch(f"/api/fragment/{f5.id}", json={"task_type": "nope"}).status_code
        == 422
    )
    assert (
        admin_client.patch("/api/fragment/99999", json={"task_type": "verification"}).status_code
        == 404
    )


def test_delete_fragment_removes_storage_file(admin_client, db_session, fragments):
    from src.storage import get_storage

    f1 = fragments[0]
    fragment_id, s3_key = f1.id, f1.s3_key
    storage = get_storage()
    storage.put(s3_key, b"RIFFxxxxWAVEdata")
    assert storage.exists(s3_key)

    resp = admin_client.delete(f"/api/fragment/{fragment_id}")
    assert resp.status_code == 204
    assert not storage.exists(s3_key)
    db_session.expire_all()
    assert db_session.query(AudioFragment).filter_by(id=fragment_id).count() == 0
    # re-deletion — 404
    assert admin_client.delete(f"/api/fragment/{fragment_id}").status_code == 404


def test_fragment_presigned(admin_client, fragments):
    f2 = fragments[1]
    resp = admin_client.get(f"/api/fragment/{f2.id}/presigned")
    assert resp.status_code == 200
    body = resp.json()
    assert body["url"] == f"/api/media/{f2.s3_key}"
    assert "expires_at" in body
    assert admin_client.get("/api/fragment/99999/presigned").status_code == 404


# ---------------------------------------------------------------------------
# Aggregates: dashboard, progress, agreement
# ---------------------------------------------------------------------------


def test_dashboard(admin_client, admin_user, project, annotators, fragments):
    resp = admin_client.get("/api/dashboard")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["projects_total"] == 1
    assert body["users_total"] == 3  # admin + 2 annotators
    assert body["fragments_total"] == 5
    assert body["fragments_labeled"] == 2
    assert body["fragments_in_progress"] == 2
    assert body["labeled_pct"] == 40

    # zombie task: in_progress 30 h ago
    assert len(body["zombie_tasks"]) == 1
    zombie = body["zombie_tasks"][0]
    assert zombie["project_id"] == project.id
    assert zombie["project_name"] == "Радио-архив 2024"
    assert zombie["fragment_filename"] == "radio_0004.wav"
    assert zombie["task_type"] == "classification"
    assert zombie["taken_by"] == "Второй Разметчик"
    assert 29 <= zombie["hours_stuck"] <= 31

    # top/outsiders: both have 2 done, agreement 50% (f1 matched, f2 did not)
    top = body["top_annotators"]
    assert len(top) == 2
    assert {a["fio"] for a in top} == {"Первый Разметчик", "Второй Разметчик"}
    assert all(a["tasks_done"] == 2 for a in top)
    assert all(a["agreement_pct"] == 50.0 for a in top)
    assert len(body["outsider_annotators"]) == 2


def test_dashboard_alias_and_zombie_threshold(admin_client, project, fragments):
    body = admin_client.get("/api/stats/dashboard").json()
    assert body["fragments_total"] == 5
    assert len(body["zombie_tasks"]) == 1

    # threshold 48 h — no zombies; the fresh task f3 is not a zombie:
    # f3 started 'now', f4 — 30 h ago; at 48 h neither is a zombie
    body = admin_client.get("/api/dashboard", params={"zombie_hours": 48}).json()
    assert body["zombie_tasks"] == []


def test_project_progress(admin_client, project, fragments):
    resp = admin_client.get(f"/api/project/{project.id}/progress")
    assert resp.status_code == 200
    assert resp.json() == {
        "project_id": project.id,
        "fragments_total": 5,
        "fragments_labeled": 2,
        "fragments_in_progress": 2,
        "zombie_tasks": 1,
        "progress_pct": 40,
    }
    assert admin_client.get("/api/project/9999/progress").status_code == 404


def test_project_agreement(admin_client, project, fragments):
    resp = admin_client.get(f"/api/project/{project.id}/agreement")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["project_id"] == project.id
    # f1: 2/2 matched -> 100; f2: 1/2 -> 50; average over fragments — 75
    assert body["avg_agreement_pct"] == 75.0
    per_type = {row["task_type"]: row["agreement_pct"] for row in body["per_type"]}
    assert per_type == {
        "transcription": 75.0,
        "classification": 0.0,  # no pairs of done tasks
        "segmentation": 0.0,
    }


def test_empty_project_aggregates(admin_client, project):
    # project without fragments: zeros, not division by zero
    resp = admin_client.get(f"/api/project/{project.id}/progress")
    assert resp.json()["fragments_total"] == 0
    assert resp.json()["progress_pct"] == 0

    resp = admin_client.get(f"/api/project/{project.id}/agreement")
    assert resp.json()["avg_agreement_pct"] == 0.0
    assert resp.json()["per_type"] == []

    resp = admin_client.get(f"/api/project/{project.id}/fragments")
    assert resp.json() == {"items": [], "total": 0, "offset": 0, "limit": 50}
