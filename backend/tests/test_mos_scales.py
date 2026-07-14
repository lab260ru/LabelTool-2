"""Tests for the 'Customizable MOS scales' feature (contract: the scale is always 1–5,
the scale name and item labels are customizable).

Coverage per contract:
  - Project.mos_scales: default when creating a mos project, round-trip of custom
    scales, null/ignored for non-mos projects;
  - validation of 1..5 scales, names non-empty and unique — 422 'bad_mos_scales';
  - PATCH mos_scales: before done tasks — 200, after — 409 'project_has_results',
    repeating the current value — no-op; switching task_type sets/clears scales;
  - MOS task payload returns the project's scales;
  - submit: {scores} over ALL scales and only them — 200, incomplete/extra/
    legacy {score}/garbage values — 422 'bad_result'.
Export jsonl/csv with scales and legacy — tests/test_export.py.
"""

import pytest
from sqlalchemy import select

from src.models import (
    AudioFragment,
    Project,
    Task,
    TaskStatus,
    TaskType,
    User,
    utcnow,
)

DEFAULT_SCALE = {"name": "Качество звучания"}
TWO_SCALES = [
    {"name": "Качество звучания", "labels": {"1": "хрип", "5": "чистый звук"}},
    {"name": "Естественность"},
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def create_project(admin_client, task_type="mos", name="Оценка синтеза TTS", **extra):
    resp = admin_client.post(
        "/api/projects", json={"name": name, "task_type": task_type, **extra}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def make_mos_project(db, scales=None, name="Оценка синтеза TTS") -> Project:
    """mos project directly in the DB (scales=None — legacy before backfill);
    participants — all existing users (for /task/random)."""
    project = Project(name=name, task_type=TaskType.mos, label_list=[], mos_scales=scales)
    project.participants = list(db.execute(select(User)).scalars())
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def make_fragment_with_task(db, project, filename="tts.wav") -> Task:
    fragment = AudioFragment(
        project_id=project.id,
        filename=filename,
        s3_key=f"p{project.id}/{filename}",
        size_bytes=1024,
        duration_sec=3.0,
        task_type=TaskType.mos,
        meta={},
    )
    db.add(fragment)
    db.flush()
    task = Task(fragment_id=fragment.id, status=TaskStatus.open)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def add_done_task(db, project, user_id, scores, filename="done.wav") -> Task:
    fragment = AudioFragment(
        project_id=project.id,
        filename=filename,
        s3_key=f"p{project.id}/{filename}",
        size_bytes=1024,
        duration_sec=3.0,
        task_type=TaskType.mos,
        meta={},
    )
    db.add(fragment)
    db.flush()
    task = Task(
        fragment_id=fragment.id,
        user_id=user_id,
        status=TaskStatus.done,
        result={"type": "mos", "scores": scores},
        started_at=utcnow(),
        finished_at=utcnow(),
    )
    db.add(task)
    db.commit()
    return task


# ---------------------------------------------------------------------------
# Project creation: default, round-trip, ignored for non-mos
# ---------------------------------------------------------------------------


def test_create_mos_project_gets_default_scale(admin_client):
    body = create_project(admin_client)
    assert body["mos_scales"] == [DEFAULT_SCALE]
    # and in the project card
    got = admin_client.get(f"/api/project/{body['id']}").json()
    assert got["mos_scales"] == [DEFAULT_SCALE]


def test_create_mos_project_with_custom_scales_roundtrip(admin_client):
    body = create_project(admin_client, mos_scales=TWO_SCALES)
    # only custom labels are stored: the second scale has no labels key
    assert body["mos_scales"] == TWO_SCALES
    got = admin_client.get(f"/api/project/{body['id']}").json()
    assert got["mos_scales"] == TWO_SCALES


def test_create_mos_project_strips_scale_names(admin_client):
    body = create_project(admin_client, mos_scales=[{"name": "  Чистота  "}])
    assert body["mos_scales"] == [{"name": "Чистота"}]


def test_create_non_mos_project_ignores_scales(admin_client):
    # for NON-mos projects the field is ignored (even if invalid) and returned as null
    body = create_project(
        admin_client,
        task_type="transcription",
        name="Радио",
        mos_scales=[{"name": ""}] * 6,
    )
    assert body["mos_scales"] is None
    got = admin_client.get(f"/api/project/{body['id']}").json()
    assert got["mos_scales"] is None


@pytest.mark.parametrize(
    "bad_scales",
    [
        [],  # fewer than 1 scale
        [{"name": f"Шкала {i}"} for i in range(6)],  # more than 5 scales
        [{"name": ""}],  # empty name
        [{"name": "   "}],  # name of only spaces
        [{"name": "Качество"}, {"name": "Качество"}],  # duplicate
        [{"name": "Качество"}, {"name": " Качество "}],  # duplicate after strip
    ],
)
def test_create_mos_scales_validation_422(admin_client, bad_scales):
    resp = admin_client.post(
        "/api/projects",
        json={"name": "X", "task_type": "mos", "mos_scales": bad_scales},
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == "bad_mos_scales"


def test_create_mos_scales_bad_label_key_422(admin_client):
    # labels keys — only '1'..'5' (rejected by schema, plain pydantic 422)
    resp = admin_client.post(
        "/api/projects",
        json={
            "name": "X",
            "task_type": "mos",
            "mos_scales": [{"name": "Качество", "labels": {"6": "вне шкалы"}}],
        },
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# PATCH mos_scales: before done — 200, after — 409, no-op, task_type switch
# ---------------------------------------------------------------------------


def test_patch_scales_before_done_ok(admin_client):
    project = create_project(admin_client)
    resp = admin_client.patch(
        f"/api/project/{project['id']}", json={"mos_scales": TWO_SCALES}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["mos_scales"] == TWO_SCALES


def test_patch_scales_validation_422(admin_client):
    project = create_project(admin_client)
    resp = admin_client.patch(
        f"/api/project/{project['id']}",
        json={"mos_scales": [{"name": "А"}, {"name": "А"}]},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "bad_mos_scales"


def test_patch_scales_after_done_409(admin_client, db_session, regular_user):
    project = create_project(admin_client)
    db_project = db_session.get(Project, project["id"])
    add_done_task(
        db_session, db_project, regular_user.id, {"Качество звучания": 4}
    )

    resp = admin_client.patch(
        f"/api/project/{project['id']}", json={"mos_scales": TWO_SCALES}
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "project_has_results"
    # scales unchanged
    got = admin_client.get(f"/api/project/{project['id']}").json()
    assert got["mos_scales"] == [DEFAULT_SCALE]

    # repeating the CURRENT value — no-op, not 409
    resp = admin_client.patch(
        f"/api/project/{project['id']}", json={"mos_scales": [DEFAULT_SCALE]}
    )
    assert resp.status_code == 200
    assert resp.json()["mos_scales"] == [DEFAULT_SCALE]


def test_patch_scales_on_non_mos_ignored(admin_client):
    project = create_project(admin_client, task_type="transcription", name="Радио")
    resp = admin_client.patch(
        f"/api/project/{project['id']}", json={"mos_scales": TWO_SCALES}
    )
    assert resp.status_code == 200
    assert resp.json()["mos_scales"] is None


def test_patch_task_type_switch_sets_and_clears_scales(admin_client):
    # empty project: transcription → mos sets default scales
    project = create_project(admin_client, task_type="transcription", name="Пустой")
    resp = admin_client.patch(f"/api/project/{project['id']}", json={"task_type": "mos"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["mos_scales"] == [DEFAULT_SCALE]

    # mos → transcription resets scales to null
    resp = admin_client.patch(
        f"/api/project/{project['id']}", json={"task_type": "transcription"}
    )
    assert resp.status_code == 200
    assert resp.json()["mos_scales"] is None

    # type switch + explicit scales in one PATCH — the explicit ones apply
    resp = admin_client.patch(
        f"/api/project/{project['id']}",
        json={"task_type": "mos", "mos_scales": TWO_SCALES},
    )
    assert resp.status_code == 200
    assert resp.json()["mos_scales"] == TWO_SCALES


# ---------------------------------------------------------------------------
# MOS task payload: the project's scales
# ---------------------------------------------------------------------------


def test_payload_lists_project_scales(user_client, db_session):
    project = make_mos_project(db_session, scales=TWO_SCALES)
    make_fragment_with_task(db_session, project)

    resp = user_client.get("/api/task/random?task_type=mos")
    assert resp.status_code == 200, resp.text
    assert resp.json()["payload"] == {
        "scale_min": 1,
        "scale_max": 5,
        "mos_scales": TWO_SCALES,
    }


def test_payload_falls_back_to_default_scale(user_client, db_session):
    # legacy mos project without mos_scales (before backfill) — effective default
    project = make_mos_project(db_session, scales=None)
    make_fragment_with_task(db_session, project)

    resp = user_client.get("/api/task/random?task_type=mos")
    assert resp.status_code == 200
    assert resp.json()["payload"]["mos_scales"] == [DEFAULT_SCALE]


# ---------------------------------------------------------------------------
# Submit: {scores} over all scales and only them; legacy {score} not accepted
# ---------------------------------------------------------------------------


@pytest.fixture()
def taken_mos_task(user_client, db_session):
    """Project with two scales and a task taken by the user."""
    project = make_mos_project(db_session, scales=TWO_SCALES)
    make_fragment_with_task(db_session, project)
    body = user_client.get("/api/task/random?task_type=mos").json()
    return body["id"]


def _submit(user_client, task_id, extra: dict):
    return user_client.post(
        f"/api/task/{task_id}/submit",
        json={"task_id": task_id, "type": "mos", **extra},
    )


def test_submit_all_scales_ok(user_client, db_session, taken_mos_task):
    resp = _submit(
        user_client,
        taken_mos_task,
        {"scores": {"Качество звучания": 4, "Естественность": 5}},
    )
    assert resp.status_code == 200, resp.text

    db_session.expire_all()
    task = db_session.get(Task, taken_mos_task)
    assert task.status == TaskStatus.done
    assert task.result == {
        "type": "mos",
        "scores": {"Качество звучания": 4, "Естественность": 5},
    }


def test_submit_integer_float_normalized(user_client, db_session, taken_mos_task):
    # JSON number 4.0 — a valid integer score, stored as int
    resp = _submit(
        user_client,
        taken_mos_task,
        {"scores": {"Качество звучания": 4.0, "Естественность": 5}},
    )
    assert resp.status_code == 200, resp.text
    db_session.expire_all()
    task = db_session.get(Task, taken_mos_task)
    assert task.result["scores"] == {"Качество звучания": 4, "Естественность": 5}


@pytest.mark.parametrize(
    "bad_extra",
    [
        {"scores": {"Качество звучания": 4}},  # not all scales rated
        {"scores": {}},  # empty scores
        {  # extra scale beyond the project's scales
            "scores": {"Качество звучания": 4, "Естественность": 5, "Лишняя": 3}
        },
        {"scores": {"Качество звучания": 4, "Чужая": 5}},  # wrong scale
        {"score": 4},  # legacy format not accepted on submit
        {},  # no scores at all
        {"scores": [4, 5]},  # not a dict
        {"scores": {"Качество звучания": 0, "Естественность": 5}},  # < 1
        {"scores": {"Качество звучания": 6, "Естественность": 5}},  # > 5
        {"scores": {"Качество звучания": "4", "Естественность": 5}},  # string
        {"scores": {"Качество звучания": 4.5, "Естественность": 5}},  # fraction
        {"scores": {"Качество звучания": True, "Естественность": 5}},  # bool
        {"scores": {"Качество звучания": None, "Естественность": 5}},  # null
    ],
)
def test_submit_bad_scores_422(user_client, db_session, taken_mos_task, bad_extra):
    resp = _submit(user_client, taken_mos_task, bad_extra)
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == "bad_result"

    # the task stays in_progress — can be submitted correctly
    db_session.expire_all()
    assert db_session.get(Task, taken_mos_task).status == TaskStatus.in_progress


def test_submit_against_default_scale(user_client, db_session):
    # legacy project without scales: submit is validated against the effective default
    project = make_mos_project(db_session, scales=None)
    make_fragment_with_task(db_session, project)
    task_id = user_client.get("/api/task/random?task_type=mos").json()["id"]

    resp = _submit(user_client, task_id, {"scores": {"Не та шкала": 3}})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "bad_result"

    resp = _submit(user_client, task_id, {"scores": {"Качество звучания": 3}})
    assert resp.status_code == 200, resp.text


def test_consensus_majority_on_scores(admin_client, db_session, regular_user):
    """Consensus majority works on the canonical JSON result:
    2 matching {scores} against 1 different → fragment agreement 2/3."""
    project = make_mos_project(db_session, scales=TWO_SCALES)
    fragment = AudioFragment(
        project_id=project.id, filename="c.wav", s3_key=f"p{project.id}/c.wav",
        size_bytes=1, duration_sec=1.0, task_type=TaskType.mos, meta={},
    )
    db_session.add(fragment)
    db_session.flush()
    same = {"Качество звучания": 4, "Естественность": 5}
    other = {"Качество звучания": 2, "Естественность": 2}
    now = utcnow()
    db_session.add_all(
        Task(
            fragment_id=fragment.id, user_id=regular_user.id, status=TaskStatus.done,
            result={"type": "mos", "scores": scores}, started_at=now, finished_at=now,
        )
        for scores in (dict(same), dict(same), other)
    )
    db_session.commit()

    resp = admin_client.get(f"/api/project/{project.id}/agreement")
    assert resp.status_code == 200
    assert resp.json()["avg_agreement_pct"] == 66.7
