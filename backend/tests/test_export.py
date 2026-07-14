"""Tests for dataset export + history.

Small dataset: a project, 3 fragments (transcription/segmentation/diarization),
done tasks of two annotators. Each format is parsed back from the archive;
history is recorded; progress reaches 100.
"""

import csv as csv_lib
import io
import json
import tarfile
import zipfile
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from src.auth import hash_password
from src.models import (
    AudioFragment,
    ExportJob,
    ExportFormat,
    ExportScope,
    ExportStatus,
    Project,
    Task,
    TaskStatus,
    TaskType,
    User,
    UserRole,
)

EXPECTED_JOB_KEYS = {
    # shape of the frontend ExportJob type (src/api/types.ts)
    "id", "project_id", "format", "scope", "include_metadata", "task_types",
    "status", "progress", "size_bytes", "filename", "download_url", "created_at",
}


def _dt(hour: int) -> datetime:
    return datetime(2026, 7, 1, hour, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Dataset fixture: project + 3 fragments + tasks with result
# ---------------------------------------------------------------------------


@pytest.fixture()
def dataset(db_session, regular_user):
    second = User(
        login="petrov",
        password_hash=hash_password("User12345"),
        fio="Петров Пётр Сергеевич",
        role=UserRole.user,
    )
    project = Project(name="Радио-архив 2024", label_list=[{"name": "речь", "color": "#D9D4F7"}])
    db_session.add_all([second, project])
    db_session.flush()

    frag_trans = AudioFragment(
        project_id=project.id, filename="radio_001.mp3", s3_key="audio/radio_001.mp3",
        size_bytes=1000, duration_sec=4.0, task_type=TaskType.transcription,
        orig_trb="черновик asr", meta={"source": "radio"},
    )
    frag_segm = AudioFragment(
        project_id=project.id, filename="radio_002.wav", s3_key="audio/radio_002.wav",
        size_bytes=2000, duration_sec=10.0, task_type=TaskType.segmentation, meta={},
    )
    frag_diar = AudioFragment(
        project_id=project.id, filename="radio_003.ogg", s3_key="audio/radio_003.ogg",
        size_bytes=3000, duration_sec=5.0, task_type=TaskType.diarization, meta={},
    )
    db_session.add_all([frag_trans, frag_segm, frag_diar])
    db_session.flush()

    same = {"type": "transcription", "text": "привет мир"}
    tasks = [
        # Transcription: majority (2×"привет мир") against a later version
        Task(fragment_id=frag_trans.id, user_id=regular_user.id, status=TaskStatus.done,
             result=dict(same), finished_at=_dt(10)),
        Task(fragment_id=frag_trans.id, user_id=second.id, status=TaskStatus.done,
             result=dict(same), finished_at=_dt(11)),
        Task(fragment_id=frag_trans.id, user_id=second.id, status=TaskStatus.done,
             result={"type": "transcription", "text": "здравствуй мир"}, finished_at=_dt(12)),
        # Segmentation: 2 segments, end before duration (checks TextGrid backfilling)
        Task(fragment_id=frag_segm.id, user_id=regular_user.id, status=TaskStatus.done,
             result={"type": "segmentation", "segments": [
                 {"start_sec": 0.0, "end_sec": 2.5, "label": "речь"},
                 {"start_sec": 2.5, "end_sec": 4.0, "label": "музыка"},
             ]}, finished_at=_dt(10)),
        # Diarization: segments with a gap between speakers
        Task(fragment_id=frag_diar.id, user_id=regular_user.id, status=TaskStatus.done,
             result={"type": "diarization", "segments": [
                 {"start_sec": 0.0, "end_sec": 3.0, "speaker": "SPK1"},
                 {"start_sec": 3.5, "end_sec": 5.0, "speaker": "SPK2"},
             ]}, finished_at=_dt(10)),
        # Unfinished task — must not appear in the export
        Task(fragment_id=frag_diar.id, user_id=second.id, status=TaskStatus.open),
    ]
    db_session.add_all(tasks)
    db_session.commit()
    return SimpleNamespace(
        project=project, frag_trans=frag_trans, frag_segm=frag_segm, frag_diar=frag_diar,
        done_tasks=5,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _start_export(client, project_id, fmt, scope="consensus", include_metadata=False,
                  task_types=None):
    body = {"format": fmt, "scope": scope, "include_metadata": include_metadata}
    if task_types is not None:
        body["task_types"] = task_types
    resp = client.post(f"/api/project/{project_id}/export", json=body)
    assert resp.status_code == 202, resp.text
    return resp.json()


def _poll_done(client, job_id):
    resp = client.get(f"/api/export/{job_id}")
    assert resp.status_code == 200, resp.text
    job = resp.json()
    assert job["status"] == "done", job
    assert job["progress"] == 100
    assert job["size_bytes"] > 0
    assert job["download_url"] == f"/api/export/{job_id}/download"
    return job


def _export_and_download(client, project_id, fmt, **kw):
    job = _start_export(client, project_id, fmt, **kw)
    done = _poll_done(client, job["id"])
    resp = client.get(done["download_url"])
    assert resp.status_code == 200
    return done, resp.content


def _read_targz(data: bytes) -> dict[str, str]:
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        return {
            m.name: tar.extractfile(m).read().decode("utf-8")
            for m in tar.getmembers() if m.isfile()
        }


def _read_zip(data: bytes) -> dict[str, str]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return {name: zf.read(name).decode("utf-8") for name in zf.namelist()}


# ---------------------------------------------------------------------------
# Job lifecycle: creation → progress 100 → history → download
# ---------------------------------------------------------------------------


def test_create_export_job_shape_and_lifecycle(admin_client, dataset):
    job = _start_export(admin_client, dataset.project.id, "jsonl")
    assert set(job) == EXPECTED_JOB_KEYS
    # 202 returns running (export screen contract: only running are polled),
    # in the DB the job is pending until the background task starts
    assert job["status"] == "running"
    assert job["progress"] == 0
    assert job["download_url"] is None
    assert job["format"] == "jsonl"
    assert job["scope"] == "consensus"
    assert job["filename"] == "radio-arhiv-2024_jsonl.tar.gz"

    done = _poll_done(admin_client, job["id"])
    assert set(done) == EXPECTED_JOB_KEYS

    # client.ts path: GET /project/{id}/export/{jobId}
    scoped = admin_client.get(f"/api/project/{dataset.project.id}/export/{job['id']}")
    assert scoped.status_code == 200
    assert scoped.json() == done


def test_history_written_newest_first(admin_client, dataset):
    first = _start_export(admin_client, dataset.project.id, "jsonl")
    second = _start_export(admin_client, dataset.project.id, "csv")

    resp = admin_client.get(f"/api/project/{dataset.project.id}/exports")
    assert resp.status_code == 200
    history = resp.json()
    assert [j["id"] for j in history] == [second["id"], first["id"]]
    for j in history:
        assert set(j) == EXPECTED_JOB_KEYS
        assert j["status"] == "done"
        assert j["progress"] == 100
        assert j["download_url"] == f"/api/export/{j['id']}/download"
    assert history[0]["filename"].endswith("_csv.zip")
    assert history[1]["filename"].endswith("_jsonl.tar.gz")


def test_download_content_disposition(admin_client, dataset):
    job = _start_export(admin_client, dataset.project.id, "csv")
    done = _poll_done(admin_client, job["id"])
    resp = admin_client.get(done["download_url"])
    assert resp.status_code == 200
    assert done["filename"] in resp.headers["content-disposition"]


# ---------------------------------------------------------------------------
# Formats: each produces a valid file, parse it back
# ---------------------------------------------------------------------------


def test_jsonl_consensus(admin_client, dataset):
    _, data = _export_and_download(admin_client, dataset.project.id, "jsonl")
    files = _read_targz(data)
    rows = [json.loads(line) for line in files["dataset.jsonl"].splitlines()]
    assert len(rows) == 3  # one line per fragment
    by_audio = {r["audio"]: r for r in rows}
    # consensus — the majority, not the latest version
    assert by_audio["radio_001.mp3"]["text"] == "привет мир"
    assert by_audio["radio_001.mp3"]["task_type"] == "transcription"
    assert by_audio["radio_001.mp3"]["annotator"] == "Петров Пётр Сергеевич"
    assert "metadata" not in by_audio["radio_001.mp3"]  # include_metadata=False
    segs = by_audio["radio_002.wav"]["segments"]
    assert [s["label"] for s in segs] == ["речь", "музыка"]
    assert by_audio["radio_003.ogg"]["segments"][0]["label"] == "SPK1"


def test_jsonl_scope_all_and_metadata(admin_client, dataset):
    _, data = _export_and_download(
        admin_client, dataset.project.id, "jsonl", scope="all", include_metadata=True
    )
    rows = [json.loads(line) for line in _read_targz(data)["dataset.jsonl"].splitlines()]
    assert len(rows) == dataset.done_tasks  # all done tasks of all annotators
    texts = {r["text"] for r in rows if r["audio"] == "radio_001.mp3"}
    assert texts == {"привет мир", "здравствуй мир"}
    frag1 = next(r for r in rows if r["audio"] == "radio_001.mp3")
    assert frag1["metadata"] == {"source": "radio"}


def test_csv_parses_back(admin_client, dataset):
    _, data = _export_and_download(
        admin_client, dataset.project.id, "csv", include_metadata=True
    )
    text = _read_zip(data)["dataset.csv"]
    rows = list(csv_lib.reader(io.StringIO(text)))
    header, body = rows[0], rows[1:]
    # without MOS records there are no mos_ columns (contract: an mos_<name> column per scale)
    assert header == [
        "fragment_id", "filename", "duration_sec", "task_type", "annotator",
        "text", "verdict", "labels", "segments", "metadata",
    ]
    assert len(body) == 3
    by_name = {r[header.index("filename")]: r for r in body}
    assert by_name["radio_001.mp3"][header.index("text")] == "привет мир"
    assert json.loads(by_name["radio_001.mp3"][header.index("metadata")]) == {"source": "radio"}
    segments = json.loads(by_name["radio_002.wav"][header.index("segments")])
    assert len(segments) == 2 and segments[0]["start_sec"] == 0.0

    # without include_metadata there is no metadata column
    _, data2 = _export_and_download(admin_client, dataset.project.id, "csv")
    header2 = next(csv_lib.reader(io.StringIO(_read_zip(data2)["dataset.csv"])))
    assert "metadata" not in header2


def test_nemo_manifest(admin_client, dataset):
    _, data = _export_and_download(admin_client, dataset.project.id, "nemo")
    rows = [json.loads(line) for line in _read_targz(data)["manifest.jsonl"].splitlines()]
    assert len(rows) == 3
    for r in rows:
        assert set(r) == {"audio_filepath", "duration", "text"}
    by_audio = {r["audio_filepath"]: r for r in rows}
    assert by_audio["radio_001.mp3"]["text"] == "привет мир"
    assert by_audio["radio_001.mp3"]["duration"] == 4.0


def test_textgrid(admin_client, dataset):
    _, data = _export_and_download(admin_client, dataset.project.id, "textgrid")
    files = _read_zip(data)
    assert set(files) == {"radio_001.TextGrid", "radio_002.TextGrid", "radio_003.TextGrid"}
    segm = files["radio_002.TextGrid"]
    assert segm.startswith('File type = "ooTextFile"')
    assert 'class = "IntervalTier"' in segm
    assert 'text = "речь"' in segm and 'text = "музыка"' in segm
    # intervals cover the whole duration (10 s): there is an empty tail 4.0..10.0
    assert "xmax = 10.0" in segm
    # diarization: gap 3.0..3.5 is filled with an empty interval
    diar = files["radio_003.TextGrid"]
    assert 'text = "SPK1"' in diar and 'text = "SPK2"' in diar and 'text = ""' in diar
    # transcription: a single interval over the whole duration with text
    assert 'text = "привет мир"' in files["radio_001.TextGrid"]


def test_conll(admin_client, dataset):
    _, data = _export_and_download(admin_client, dataset.project.id, "conll")
    text = _read_zip(data)["dataset.conll"]
    assert "# fragment = radio_001.mp3" in text
    assert "привет\tO" in text and "мир\tO" in text
    blocks = [b for b in text.split("\n\n") if b.strip()]
    assert len(blocks) == 3
    for line in text.splitlines():
        if line and not line.startswith("#"):
            assert len(line.split("\t")) == 2  # token<TAB>tag


def test_srt_vtt(admin_client, dataset):
    _, data = _export_and_download(admin_client, dataset.project.id, "srt_vtt")
    files = _read_zip(data)
    assert {"radio_001.srt", "radio_001.vtt", "radio_002.srt", "radio_002.vtt",
            "radio_003.srt", "radio_003.vtt"} == set(files)
    srt = files["radio_002.srt"]
    assert "1\n00:00:00,000 --> 00:00:02,500\nречь" in srt
    assert "2\n00:00:02,500 --> 00:00:04,000\nмузыка" in srt
    vtt = files["radio_002.vtt"]
    assert vtt.startswith("WEBVTT")
    assert "00:00:00.000 --> 00:00:02.500\nречь" in vtt
    # transcription without segments — a single cue over the whole duration
    assert "00:00:00,000 --> 00:00:04,000\nпривет мир" in files["radio_001.srt"]


# ---------------------------------------------------------------------------
# MOS projects: jsonl (scores object) / csv (an mos_<name> column per scale),
# legacy {score: N} is read as {scores: {'MOS': N}}, other formats — 422
# ---------------------------------------------------------------------------


@pytest.fixture()
def mos_dataset(db_session, regular_user):
    """MOS project with TWO customizable scales; tts_1 submitted in the current
    {scores} format, tts_2 — legacy {score} (read as scores.MOS)."""
    project = Project(
        name="Оценка синтеза TTS", task_type=TaskType.mos, label_list=[],
        mos_scales=[
            {"name": "Качество звучания", "labels": {"1": "плохо", "5": "отлично"}},
            {"name": "Естественность"},
        ],
    )
    db_session.add(project)
    db_session.flush()
    fragments = [
        AudioFragment(
            project_id=project.id, filename=f"tts_{i}.wav", s3_key=f"audio/tts_{i}.wav",
            size_bytes=100 * i, duration_sec=float(i), task_type=TaskType.mos, meta={},
        )
        for i in (1, 2)
    ]
    db_session.add_all(fragments)
    db_session.flush()
    db_session.add_all(
        [
            Task(fragment_id=fragments[0].id, user_id=regular_user.id,
                 status=TaskStatus.done,
                 result={"type": "mos",
                         "scores": {"Качество звучания": 4, "Естественность": 5}},
                 finished_at=_dt(10)),
            # legacy result predating customizable scales — remains readable
            Task(fragment_id=fragments[1].id, user_id=regular_user.id,
                 status=TaskStatus.done, result={"type": "mos", "score": 5},
                 finished_at=_dt(11)),
        ]
    )
    db_session.commit()
    return SimpleNamespace(project=project)


def test_mos_jsonl_scores_per_scale_and_legacy(admin_client, mos_dataset):
    _, data = _export_and_download(admin_client, mos_dataset.project.id, "jsonl")
    rows = [json.loads(line) for line in _read_targz(data)["dataset.jsonl"].splitlines()]
    assert len(rows) == 2
    by_audio = {r["audio"]: r for r in rows}
    # scores object per-scale (contract item 5)
    assert by_audio["tts_1.wav"]["scores"] == {
        "Качество звучания": 4, "Естественность": 5,
    }
    # legacy {score: N} is treated as {scores: {'MOS': N}}
    assert by_audio["tts_2.wav"]["scores"] == {"MOS": 5}
    assert by_audio["tts_1.wav"]["task_type"] == "mos"
    assert by_audio["tts_1.wav"]["text"] is None
    assert by_audio["tts_1.wav"]["segments"] == []
    assert "score" not in by_audio["tts_1.wav"]


def test_mos_csv_column_per_scale_and_legacy(admin_client, mos_dataset):
    _, data = _export_and_download(admin_client, mos_dataset.project.id, "csv")
    text = _read_zip(data)["dataset.csv"]
    rows = list(csv_lib.reader(io.StringIO(text)))
    header, body = rows[0], rows[1:]
    # an mos_<name> column per scale; legacy {score} → mos_MOS
    assert header[-3:] == ["mos_Качество звучания", "mos_Естественность", "mos_MOS"]
    by_name = {r[header.index("filename")]: r for r in body}
    assert by_name["tts_1.wav"][header.index("mos_Качество звучания")] == "4"
    assert by_name["tts_1.wav"][header.index("mos_Естественность")] == "5"
    assert by_name["tts_1.wav"][header.index("mos_MOS")] == ""
    assert by_name["tts_2.wav"][header.index("mos_MOS")] == "5"
    assert by_name["tts_2.wav"][header.index("mos_Качество звучания")] == ""
    assert by_name["tts_1.wav"][header.index("task_type")] == "mos"


@pytest.mark.parametrize("fmt", ["nemo", "textgrid", "conll", "srt_vtt"])
def test_mos_format_not_applicable(admin_client, mos_dataset, fmt):
    # decision documented in routers/export.py: mos tasks have no text
    # and no segments, formats other than jsonl/csv are not applicable → 422
    resp = admin_client.post(
        f"/api/project/{mos_dataset.project.id}/export",
        json={"format": fmt, "scope": "consensus"},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "format_not_applicable"

    # job not created
    assert admin_client.get(f"/api/project/{mos_dataset.project.id}/exports").json() == []


def test_non_mos_project_all_formats_allowed(admin_client, dataset):
    # regular projects have no restriction — a job is created for any format
    for fmt in ("nemo", "textgrid", "conll", "srt_vtt"):
        _start_export(admin_client, dataset.project.id, fmt)


# ---------------------------------------------------------------------------
# Options: task_types filter
# ---------------------------------------------------------------------------


def test_task_types_filter(admin_client, dataset):
    job = _start_export(
        admin_client, dataset.project.id, "jsonl", task_types=["transcription"]
    )
    assert job["task_types"] == ["transcription"]
    done = _poll_done(admin_client, job["id"])
    data = admin_client.get(done["download_url"]).content
    rows = [json.loads(line) for line in _read_targz(data)["dataset.jsonl"].splitlines()]
    assert [r["audio"] for r in rows] == ["radio_001.mp3"]


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------


def test_cancel_pending_job(admin_client, db_session, dataset):
    job = ExportJob(
        project_id=dataset.project.id, format=ExportFormat.jsonl,
        scope=ExportScope.consensus, status=ExportStatus.pending,
        file_key=f"exports/{dataset.project.id}/999/x_jsonl.tar.gz",
    )
    db_session.add(job)
    db_session.commit()

    resp = admin_client.delete(f"/api/project/{dataset.project.id}/export/{job.id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"

    status = admin_client.get(f"/api/export/{job.id}")
    assert status.json()["status"] == "cancelled"
    # re-cancelling a finished one — 404
    assert admin_client.delete(
        f"/api/project/{dataset.project.id}/export/{job.id}"
    ).status_code == 404


def test_cancel_done_job_is_404(admin_client, dataset):
    job = _start_export(admin_client, dataset.project.id, "jsonl")
    _poll_done(admin_client, job["id"])
    resp = admin_client.delete(f"/api/project/{dataset.project.id}/export/{job['id']}")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Errors and authorization
# ---------------------------------------------------------------------------


def test_project_not_found(admin_client):
    resp = admin_client.post(
        "/api/project/9999/export", json={"format": "jsonl", "scope": "consensus"}
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "project_not_found"
    assert admin_client.get("/api/project/9999/exports").status_code == 404


def test_export_not_found(admin_client, dataset):
    assert admin_client.get("/api/export/424242").status_code == 404
    assert admin_client.get("/api/export/424242/download").status_code == 404
    # a job from another project is not returned by the project scope
    job = _start_export(admin_client, dataset.project.id, "jsonl")
    assert admin_client.get(f"/api/project/9999/export/{job['id']}").status_code == 404


def test_invalid_format_422(admin_client, dataset):
    resp = admin_client.post(
        f"/api/project/{dataset.project.id}/export", json={"format": "xml"}
    )
    assert resp.status_code == 422


def test_requires_admin(client, user_client):
    # without a session — 401; a regular annotator — 403
    assert client.get("/api/project/1/exports").status_code in (401, 403)
    resp = user_client.post(
        "/api/project/1/export", json={"format": "jsonl", "scope": "consensus"}
    )
    assert resp.status_code == 403
    assert user_client.get("/api/project/1/exports").status_code == 403
