"""Tests of the consensus mechanism (Project.consensus_overlap = K):

  - K open tasks are created per fragment (file and manifest);
  - /task/random: users A and B get the SAME fragment when K=2; user A cannot
    take/submit the same fragment twice; a third user gets nothing when K=2;
  - fragment is finished after K submissions; 'labeled'/'in progress' aggregates from K;
  - PATCH consensus_overlap up/down recomputes open tasks
    (done/in_progress are untouched);
  - export scope=consensus — majority of K done results
    (on a tie — the latest by time).
"""

import io
import json
import tarfile
import uuid
from datetime import datetime, timezone

import pytest
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
)
from src.serializers import pick_consensus
from tests.conftest import ADMIN_PASSWORD, USER_PASSWORD, login_as

WAV_BYTES = b"RIFFxxxxWAVEdata"  # valid magic bytes + length >= 12


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_project(db, name="Консенсус-проект", overlap=2, task_type=TaskType.transcription) -> Project:
    project = Project(
        name=name, description="", instruction="", label_list=[],
        task_type=task_type, consensus_overlap=overlap,
    )
    db.add(project)
    # /task/random gives tasks only to project participants — the test project
    # includes all users existing at this moment
    project.participants = list(db.execute(select(User)).scalars())
    db.commit()
    db.refresh(project)
    return project


def make_fragment(db, project, filename="a.wav", open_tasks: int | None = None) -> AudioFragment:
    """Fragment with open_tasks open tasks (default — the project's K)."""
    n = project.consensus_overlap if open_tasks is None else open_tasks
    fragment = AudioFragment(
        project_id=project.id,
        filename=filename,
        s3_key=f"p{project.id}/{uuid.uuid4().hex}-{filename}",
        size_bytes=1024,
        duration_sec=2.0,
        task_type=project.task_type,
        meta={},
        tasks=[Task(status=TaskStatus.open) for _ in range(n)],
    )
    db.add(fragment)
    db.commit()
    db.refresh(fragment)
    return fragment


def make_user(db, login: str) -> User:
    user = User(
        login=login, password_hash=hash_password(USER_PASSWORD),
        fio=login.title(), role=UserRole.user, permissions={},
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def take_task(client, login: str) -> dict:
    """Re-login as `login` and grab a task via /task/random."""
    login_as(client, login, USER_PASSWORD)
    resp = client.get("/api/task/random")
    assert resp.status_code == 200, resp.text
    return resp.json()


def submit(client, task: dict, text: str) -> None:
    resp = client.post(
        f"/api/task/{task['id']}/submit",
        json={"task_id": task["id"], "type": "transcription", "text": text},
    )
    assert resp.status_code == 200, resp.text


def tasks_by_status(db, fragment_id: int) -> dict[str, int]:
    db.rollback()  # close the reading transaction, see the app's commits
    rows = db.execute(select(Task.status).where(Task.fragment_id == fragment_id)).scalars()
    counts: dict[str, int] = {}
    for status in rows:
        counts[status.value] = counts.get(status.value, 0) + 1
    return counts


@pytest.fixture()
def users(db_session) -> tuple[User, User, User]:
    return (
        make_user(db_session, "ann-a"),
        make_user(db_session, "ann-b"),
        make_user(db_session, "ann-c"),
    )


# ---------------------------------------------------------------------------
# /task/random dispatch when K=2
# ---------------------------------------------------------------------------


def test_two_users_get_same_fragment_at_k2(client, db_session, users):
    project = make_project(db_session)
    fragment = make_fragment(db_session, project)  # 2 open tasks

    task_a = take_task(client, "ann-a")
    task_b = take_task(client, "ann-b")

    # Both got the SAME fragment, but DIFFERENT tasks
    assert task_a["fragment"]["id"] == fragment.id
    assert task_b["fragment"]["id"] == fragment.id
    assert task_a["id"] != task_b["id"]

    db_session.rollback()
    a, b = db_session.get(Task, task_a["id"]), db_session.get(Task, task_b["id"])
    assert a.status == b.status == TaskStatus.in_progress
    assert {a.user_id, b.user_id} == {users[0].id, users[1].id}


def test_same_user_cannot_take_fragment_twice(client, db_session, users):
    project = make_project(db_session)
    make_fragment(db_session, project)  # K=2: 2 open tasks

    task_a = take_task(client, "ann-a")
    # Repeated request before submit — the same in_progress task, not a second open one
    repeat = client.get("/api/task/random")
    assert repeat.status_code == 200
    assert repeat.json()["id"] == task_a["id"]

    # After submit the fragment's second open task is not given to user A
    submit(client, task_a, "первый прогон")
    resp = client.get("/api/task/random")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "no_tasks_available"


def test_third_user_gets_nothing_at_k2(client, db_session, users):
    project = make_project(db_session)
    make_fragment(db_session, project)

    task_a = take_task(client, "ann-a")
    submit(client, task_a, "разметка А")
    take_task(client, "ann-b")  # B holds the second task in_progress

    # Both tasks of the fragment are taken (done + in_progress) — nothing for the third
    login_as(client, "ann-c", USER_PASSWORD)
    resp = client.get("/api/task/random")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "no_tasks_available"


# ---------------------------------------------------------------------------
# finished and aggregates from K
# ---------------------------------------------------------------------------


def test_finished_after_k_submissions_and_aggregates(client, db_session, admin_user, users):
    project = make_project(db_session)
    fragment = make_fragment(db_session, project)

    task_a = take_task(client, "ann-a")
    submit(client, task_a, "текст")

    # 1 done out of 2 — not finished; aggregates: 'in progress' (0 < done < K)
    login_as(client, admin_user.login, ADMIN_PASSWORD)
    body = client.get(f"/api/project/{project.id}/fragments").json()
    item = body["items"][0]
    assert item["finished"] is False
    assert item["tasks_done"] == 1
    assert item["tasks_required"] == 2
    assert item["task_count"] == 1
    progress = client.get(f"/api/project/{project.id}/progress").json()
    assert progress["fragments_total"] == 1
    assert progress["fragments_labeled"] == 0
    assert progress["fragments_in_progress"] == 1
    assert progress["progress_pct"] == 0

    # the project returns consensus_overlap in all Project responses
    assert client.get(f"/api/project/{project.id}").json()["consensus_overlap"] == 2
    listed = client.get("/api/projects").json()
    assert [p["consensus_overlap"] for p in listed if p["id"] == project.id] == [2]

    # Second submission (K=2) — fragment finished, project labeled to 100%
    task_b = take_task(client, "ann-b")
    submit(client, task_b, "текст")
    login_as(client, admin_user.login, ADMIN_PASSWORD)
    item = client.get(f"/api/project/{project.id}/fragments").json()["items"][0]
    assert item["finished"] is True
    assert item["tasks_done"] == 2
    assert item["tasks_required"] == 2
    progress = client.get(f"/api/project/{project.id}/progress").json()
    assert progress["fragments_labeled"] == 1
    assert progress["fragments_in_progress"] == 0
    assert progress["progress_pct"] == 100

    # the finished filter accounts for K
    assert client.get(
        f"/api/project/{project.id}/fragments", params={"finished": "true"}
    ).json()["total"] == 1
    assert client.get(
        f"/api/project/{project.id}/fragments", params={"finished": "false"}
    ).json()["total"] == 0

    # /dashboard counts from the same semantics
    dash = client.get("/api/dashboard").json()
    assert dash["fragments_labeled"] == 1
    assert dash["fragments_in_progress"] == 0


# ---------------------------------------------------------------------------
# POST/PATCH consensus_overlap
# ---------------------------------------------------------------------------


def test_create_project_accepts_and_validates_overlap(admin_client):
    resp = admin_client.post(
        "/api/projects",
        json={"name": "К2", "task_type": "transcription", "consensus_overlap": 2},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["consensus_overlap"] == 2

    # default — 1 (no consensus)
    resp = admin_client.post("/api/projects", json={"name": "К1", "task_type": "mos"})
    assert resp.status_code == 201
    assert resp.json()["consensus_overlap"] == 1

    # validation 1..5
    for bad in (0, 6, -1):
        resp = admin_client.post(
            "/api/projects",
            json={"name": "X", "task_type": "transcription", "consensus_overlap": bad},
        )
        assert resp.status_code == 422, bad


def test_patch_overlap_up_adds_open_tasks(admin_client, db_session, users):
    project = make_project(db_session, overlap=1)
    f1 = make_fragment(db_session, project, "f1.wav")  # 1 open
    f2 = make_fragment(db_session, project, "f2.wav")  # 1 open

    task_a = take_task(admin_client, "ann-a")  # takes f1 or f2
    submit(admin_client, task_a, "сдано")
    done_fragment_id = task_a["fragment"]["id"]
    other_id = f2.id if done_fragment_id == f1.id else f1.id

    login_as(admin_client, "akim", ADMIN_PASSWORD)
    resp = admin_client.patch(f"/api/project/{project.id}", json={"consensus_overlap": 3})
    assert resp.status_code == 200, resp.text
    assert resp.json()["consensus_overlap"] == 3

    # done fragment: 1 done untouched + 2 open created (up to K=3)
    assert tasks_by_status(db_session, done_fragment_id) == {"done": 1, "open": 2}
    # untouched fragment: open pool brought up to 3
    assert tasks_by_status(db_session, other_id) == {"open": 3}

    # finished recomputed: done=1 < 3 — fragment is 'not labeled' again
    body = admin_client.get(f"/api/project/{project.id}/fragments").json()
    by_id = {i["id"]: i for i in body["items"]}
    assert by_id[done_fragment_id]["finished"] is False
    assert by_id[done_fragment_id]["tasks_required"] == 3


def test_patch_overlap_down_removes_open_tasks(admin_client, db_session, users):
    project = make_project(db_session, overlap=3)
    f1 = make_fragment(db_session, project, "f1.wav")  # 3 open
    f2 = make_fragment(db_session, project, "f2.wav")  # 3 open

    # ann-a submits on f1, ann-b holds in_progress on f1 or f2
    login_as(admin_client, "ann-a", USER_PASSWORD)
    resp = admin_client.get(f"/api/task/random?project_id={project.id}")
    assert resp.status_code == 200, resp.text
    task_a = resp.json()
    submit(admin_client, task_a, "сдано")  # "submitted"
    login_as(admin_client, "ann-b", USER_PASSWORD)
    resp = admin_client.get(f"/api/task/random?project_id={project.id}")
    assert resp.status_code == 200, resp.text
    task_b = resp.json()

    login_as(admin_client, "akim", ADMIN_PASSWORD)
    resp = admin_client.patch(f"/api/project/{project.id}", json={"consensus_overlap": 1})
    assert resp.status_code == 200, resp.text
    assert resp.json()["consensus_overlap"] == 1

    # done/in_progress untouched, extra open removed
    a_frag, b_frag = task_a["fragment"]["id"], task_b["fragment"]["id"]
    counts_a = tasks_by_status(db_session, a_frag)
    assert counts_a["done"] == 1
    assert counts_a.get("open", 0) == 0
    counts_b = tasks_by_status(db_session, b_frag)
    assert counts_b["in_progress"] == 1
    assert counts_b.get("open", 0) == 0
    if a_frag != b_frag:  # b-fragment has busy=1 (in_progress) — pool is also 0
        assert counts_b == {"in_progress": 1}

    # finished recomputed: done=1 >= K=1
    body = admin_client.get(f"/api/project/{project.id}/fragments").json()
    by_id = {i["id"]: i for i in body["items"]}
    assert by_id[a_frag]["finished"] is True
    assert by_id[a_frag]["tasks_required"] == 1

    # repeating the current value — no-op (recompute does not break state)
    resp = admin_client.patch(f"/api/project/{project.id}", json={"consensus_overlap": 1})
    assert resp.status_code == 200
    assert tasks_by_status(db_session, a_frag) == counts_a


def test_patch_overlap_validation(admin_client, db_session):
    project = make_project(db_session, overlap=2)
    for bad in (0, 6):
        resp = admin_client.patch(
            f"/api/project/{project.id}", json={"consensus_overlap": bad}
        )
        assert resp.status_code == 422, bad


# ---------------------------------------------------------------------------
# Upload: K open tasks per fragment (file and manifest)
# ---------------------------------------------------------------------------


def test_upload_file_creates_k_open_tasks(admin_client, db_session):
    project = make_project(db_session, overlap=3)
    resp = admin_client.post(
        "/api/upload/session",
        json={
            "project_id": project.id, "metadata": {}, "orig_trb": {},
            "files": [{"client_id": "f1", "filename": "x.wav", "size": 16, "duration": 1.0}],
        },
    )
    assert resp.status_code == 201, resp.text
    session_id = resp.json()["session_id"]
    resp = admin_client.post(
        f"/api/upload/session/{session_id}/file/f1", content=WAV_BYTES
    )
    assert resp.status_code == 200 and resp.json()["ok"], resp.text
    fragment_id = resp.json()["fragment_id"]
    assert tasks_by_status(db_session, fragment_id) == {"open": 3}


def test_manifest_import_creates_k_open_tasks(admin_client, db_session):
    project = make_project(db_session, overlap=2)
    resp = admin_client.post(
        f"/api/project/{project.id}/manifest",
        data={"mapping": json.dumps({"filename": "filename"})},
        files={"file": ("m.csv", b"filename\nm1.wav\nm2.wav\n")},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["uploaded"] == 2
    db_session.expire_all()
    fragments = db_session.execute(
        select(AudioFragment).where(AudioFragment.project_id == project.id)
    ).scalars().all()
    assert len(fragments) == 2
    for fragment in fragments:
        assert tasks_by_status(db_session, fragment.id) == {"open": 2}


# ---------------------------------------------------------------------------
# Export scope=consensus: majority of K, on a tie — the latest
# ---------------------------------------------------------------------------


def _dt(hour: int) -> datetime:
    return datetime(2026, 7, 1, hour, 0, tzinfo=timezone.utc)


def _done(fragment, text: str, hour: int) -> Task:
    return Task(
        fragment_id=fragment.id, status=TaskStatus.done,
        result={"type": "transcription", "text": text}, finished_at=_dt(hour),
    )


def test_pick_consensus_majority_and_tie():
    def stub(result, hour, task_id):
        task = Task(status=TaskStatus.done, result=result, finished_at=_dt(hour))
        task.id = task_id
        return task

    # Majority 2×"да" against a later "нет"
    majority = pick_consensus([
        stub({"text": "да"}, 10, 1),
        stub({"text": "да"}, 11, 2),
        stub({"text": "нет"}, 12, 3),
    ])
    assert majority.result["text"] == "да"

    # Tie 1:1 (K=2) — the latest by time wins
    tie = pick_consensus([
        stub({"text": "раньше"}, 10, 4),
        stub({"text": "позже"}, 11, 5),
    ])
    assert tie.result["text"] == "позже"

    assert pick_consensus([]) is None


def test_export_consensus_majority_at_k(admin_client, db_session):
    project = make_project(db_session, overlap=3)
    f_major = make_fragment(db_session, project, "major.wav", open_tasks=0)
    f_tie = make_fragment(db_session, project, "tie.wav", open_tasks=0)
    db_session.add_all([
        # 2×"привет" against a later "пока" — majority wins
        _done(f_major, "привет", 10),
        _done(f_major, "привет", 11),
        _done(f_major, "пока", 12),
        # tie 1:1 — the latest by time
        _done(f_tie, "первый", 10),
        _done(f_tie, "второй", 11),
    ])
    db_session.commit()

    job = admin_client.post(
        f"/api/project/{project.id}/export",
        json={"format": "jsonl", "scope": "consensus"},
    )
    assert job.status_code == 202, job.text
    job_id = job.json()["id"]
    status = admin_client.get(f"/api/export/{job_id}").json()
    assert status["status"] == "done", status

    data = admin_client.get(f"/api/export/{job_id}/download").content
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        text = tar.extractfile("dataset.jsonl").read().decode("utf-8")
    rows = {r["audio"]: r for r in map(json.loads, text.splitlines())}
    assert len(rows) == 2  # one record per fragment
    assert rows["major.wav"]["text"] == "привет"
    assert rows["tie.wav"]["text"] == "второй"
