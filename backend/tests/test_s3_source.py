"""Tests for the 'Connect data from S3' feature (reference-in-place).

moto is not in the venv → the boto3 client is mocked with a fake (monkeypatch boto3.client)
that lists a GIVEN set of bucket keys. In tests the app runs on
LocalStorage (STORAGE_BACKEND=local), so S3Storage is not touched —
the fake client is used ONLY by the source (S3SourceStorage).

Coverage per contract:
  - create: connection check (success/fail→400 s3_connection_failed),
    secret_key/access_key NOT in the response, validation of empty fields;
  - list: object_count of imported fragments, without secrets;
  - preview: audio filter, prefix, sbs pairs, already_imported, truncated,
    listing pagination (ContinuationToken);
  - import: creating fragments+K tasks, basename/size/task_type,
    idempotency, sbs pairs/unpaired;
  - presigned routing of a fragment with source_id (fragments/task);
  - cascading deletion of a source (fragments+tasks), without deleting objects.
"""

import pytest
from sqlalchemy import func, select

from src.models import AudioFragment, S3Source, Task, TaskStatus, TaskType
from tests.conftest import USER_PASSWORD, login_as


# ---------------------------------------------------------------------------
# Fake boto3 S3 client (lists a given set of bucket keys)
# ---------------------------------------------------------------------------


class FakeS3Store:
    """Shared fake store: bucket → {key: size}, a set of 'failing' buckets,
    listing page size (to check ContinuationToken pagination)."""

    def __init__(self) -> None:
        self.buckets: dict[str, dict[str, int]] = {}
        self.fail_buckets: set[str] = set()
        self.page_size = 1000

    def seed(self, bucket: str, mapping: dict[str, int]) -> None:
        self.buckets.setdefault(bucket, {}).update(mapping)


class FakeS3Client:
    def __init__(self, store: FakeS3Store) -> None:
        self._store = store

    def _keys(self, bucket: str, prefix: str) -> list[str]:
        return sorted(k for k in self._store.buckets.get(bucket, {}) if k.startswith(prefix or ""))

    def list_objects_v2(self, Bucket, Prefix="", MaxKeys=None, ContinuationToken=None, **kw):
        if Bucket in self._store.fail_buckets:
            raise RuntimeError("fake s3: bucket unavailable")
        keys = self._keys(Bucket, Prefix)
        cap = self._store.page_size if MaxKeys is None else min(MaxKeys, self._store.page_size)
        start = int(ContinuationToken) if ContinuationToken else 0
        chunk = keys[start : start + cap]
        nxt = start + len(chunk)
        resp: dict = {
            "Contents": [{"Key": k, "Size": self._store.buckets[Bucket][k]} for k in chunk]
        }
        truncated = nxt < len(keys)
        resp["IsTruncated"] = truncated
        if truncated:
            resp["NextContinuationToken"] = str(nxt)
        return resp

    def head_object(self, Bucket, Key, **kw):
        sizes = self._store.buckets.get(Bucket, {})
        if Key not in sizes:
            raise RuntimeError("fake s3: no such key")
        return {"ContentLength": sizes[Key]}

    def generate_presigned_url(self, op, Params=None, ExpiresIn=None, **kw):
        p = Params or {}
        return f"https://fake-s3/{p.get('Bucket')}/{p.get('Key')}?exp={ExpiresIn}"


@pytest.fixture()
def fake_s3(monkeypatch):
    """Patches boto3.client with the fake; returns the store to fill with keys."""
    import boto3

    store = FakeS3Store()
    monkeypatch.setattr(boto3, "client", lambda *a, **kw: FakeS3Client(store))
    return store


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SOURCE_BODY = {
    "name": "MinIO прод",
    "endpoint_url": "http://minio:9000",
    "bucket": "audio",
    "prefix": "",
    "access_key": "AKIA_DEMO",
    "secret_key": "s3cr3t-key-value",
    "path_style": True,
}


def create_project(admin_client, task_type="transcription", **extra):
    resp = admin_client.post(
        "/api/projects",
        json={"name": "S3-проект", "task_type": task_type, "consensus_overlap": 2, **extra},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def create_source(admin_client, project_id, **overrides):
    body = {**SOURCE_BODY, **overrides}
    resp = admin_client.post(f"/api/project/{project_id}/s3-sources", json=body)
    return resp


# ---------------------------------------------------------------------------
# create: connection check, no secrets, validation
# ---------------------------------------------------------------------------


def test_create_source_ok_no_secret_in_response(admin_client, db_session, fake_s3):
    project = create_project(admin_client)
    resp = create_source(admin_client, project["id"])
    assert resp.status_code == 201, resp.text
    body = resp.json()
    # secret_key AND access_key are NEVER in the response
    assert "secret_key" not in body
    assert "access_key" not in body
    assert body["name"] == "MinIO прод"
    assert body["bucket"] == "audio"
    assert body["path_style"] is True
    assert body["object_count"] == 0
    # secret_key IS still STORED in the DB (infrastructure config)
    source = db_session.execute(select(S3Source)).scalars().one()
    assert source.secret_key == "s3cr3t-key-value"
    assert source.access_key == "AKIA_DEMO"


def test_create_source_connection_failed_400_not_persisted(admin_client, db_session, fake_s3):
    project = create_project(admin_client)
    fake_s3.fail_buckets.add("audio")  # bucket unavailable → check_connection raises
    resp = create_source(admin_client, project["id"])
    assert resp.status_code == 400
    assert resp.json()["detail"] == "s3_connection_failed"
    # source NOT created
    assert db_session.scalar(select(func.count()).select_from(S3Source)) == 0
    got = admin_client.get(f"/api/project/{project['id']}/s3-sources").json()
    assert got == []


def test_create_source_empty_fields_422(admin_client, fake_s3):
    project = create_project(admin_client)
    resp = create_source(admin_client, project["id"], name="")
    assert resp.status_code == 422


def test_create_source_project_not_found(admin_client, fake_s3):
    resp = create_source(admin_client, 999999)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "project_not_found"


def test_create_source_forbidden_for_user(user_client, fake_s3):
    # an annotator is not an admin — 403
    resp = user_client.post("/api/project/1/s3-sources", json=SOURCE_BODY)
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# list: object_count, without secrets
# ---------------------------------------------------------------------------


def test_list_sources_object_count(admin_client, fake_s3):
    # object_count — number of AUDIO objects under the prefix (live listing),
    # not the number imported; note.txt is not audio → not counted
    fake_s3.seed("audio", {"a.mp3": 100, "b.wav": 200, "note.txt": 5})
    project = create_project(admin_client)
    src = create_source(admin_client, project["id"]).json()
    sources = admin_client.get(f"/api/project/{project['id']}/s3-sources").json()
    assert len(sources) == 1
    assert sources[0]["object_count"] == 2  # a.mp3 + b.wav (without import)
    assert "secret_key" not in sources[0] and "access_key" not in sources[0]


def test_list_sources_object_count_null_when_unreachable(admin_client, fake_s3):
    # source created successfully, then became unavailable → object_count=null,
    # but the list does not fail (an admin must be able to delete a broken source)
    fake_s3.seed("audio", {"a.mp3": 1})
    project = create_project(admin_client)
    create_source(admin_client, project["id"])
    fake_s3.fail_buckets.add("audio")
    sources = admin_client.get(f"/api/project/{project['id']}/s3-sources").json()
    assert len(sources) == 1
    assert sources[0]["object_count"] is None


# ---------------------------------------------------------------------------
# preview: audio filter, prefix, already_imported, truncated, pagination
# ---------------------------------------------------------------------------


def test_preview_audio_filter_and_prefix(admin_client, fake_s3):
    fake_s3.seed(
        "audio",
        {
            "clips/one.mp3": 10,
            "clips/two.wav": 20,
            "clips/readme.txt": 3,  # not audio
            "other/three.mp3": 30,  # outside the prefix
        },
    )
    project = create_project(admin_client)
    src = create_source(admin_client, project["id"], prefix="clips/").json()
    prev = admin_client.post(f"/api/s3-source/{src['id']}/preview").json()
    assert prev["total_audio"] == 2  # only audio under clips/
    assert set(prev["sample"]) == {"clips/one.mp3", "clips/two.wav"}
    assert prev["already_imported"] == 0
    assert prev["to_import"] == 2
    assert prev["truncated"] is False
    assert prev["pairs"] is None and prev["unpaired"] is None


def test_preview_already_imported_after_import(admin_client, fake_s3):
    fake_s3.seed("audio", {"a.mp3": 1, "b.mp3": 2, "c.mp3": 3})
    project = create_project(admin_client)
    src = create_source(admin_client, project["id"]).json()
    admin_client.post(f"/api/s3-source/{src['id']}/import")
    prev = admin_client.post(f"/api/s3-source/{src['id']}/preview").json()
    assert prev["total_audio"] == 3
    assert prev["already_imported"] == 3
    assert prev["to_import"] == 0


def test_preview_truncated_ceiling(admin_client, fake_s3, monkeypatch):
    monkeypatch.setattr("src.routers.s3_source.MAX_LIST_OBJECTS", 3)
    fake_s3.seed("audio", {f"f{i}.mp3": i for i in range(5)})
    project = create_project(admin_client)
    src = create_source(admin_client, project["id"]).json()
    prev = admin_client.post(f"/api/s3-source/{src['id']}/preview").json()
    assert prev["total_audio"] == 3
    assert prev["truncated"] is True


def test_preview_pagination_continuation_token(admin_client, fake_s3):
    # small listing page → several requests with ContinuationToken
    fake_s3.page_size = 2
    fake_s3.seed("audio", {f"f{i}.mp3": i + 1 for i in range(5)})
    project = create_project(admin_client)
    src = create_source(admin_client, project["id"]).json()
    prev = admin_client.post(f"/api/s3-source/{src['id']}/preview").json()
    assert prev["total_audio"] == 5  # all 5 despite pages of 2


# ---------------------------------------------------------------------------
# import: fragments + K tasks, basename/size/task_type, idempotency
# ---------------------------------------------------------------------------


def test_import_creates_fragments_and_tasks(admin_client, db_session, fake_s3):
    fake_s3.seed("audio", {"clips/rec1.mp3": 111, "clips/rec2.wav": 222, "clips/x.txt": 9})
    project = create_project(admin_client, consensus_overlap=2)
    src = create_source(admin_client, project["id"], prefix="clips/").json()
    res = admin_client.post(f"/api/s3-source/{src['id']}/import").json()
    assert res == {"imported": 2, "skipped": 0, "unpaired": None}

    frags = db_session.execute(
        select(AudioFragment).where(AudioFragment.project_id == project["id"]).order_by(AudioFragment.filename)
    ).scalars().all()
    assert len(frags) == 2
    f1 = frags[0]
    assert f1.filename == "rec1.mp3"  # basename of the key
    assert f1.s3_key == "clips/rec1.mp3"  # full key of the source object
    assert f1.size_bytes == 111  # from the listing Size (== ContentLength)
    assert f1.duration_sec is None
    assert f1.source_id == src["id"]
    assert f1.task_type == TaskType.transcription  # inherited from the project
    # K = consensus_overlap open tasks per fragment
    total_tasks = db_session.scalar(
        select(func.count()).select_from(Task).where(Task.fragment_id == f1.id)
    )
    assert total_tasks == 2


def test_import_idempotent(admin_client, fake_s3):
    fake_s3.seed("audio", {"a.mp3": 1, "b.mp3": 2})
    project = create_project(admin_client)
    src = create_source(admin_client, project["id"]).json()
    first = admin_client.post(f"/api/s3-source/{src['id']}/import").json()
    assert first["imported"] == 2 and first["skipped"] == 0
    second = admin_client.post(f"/api/s3-source/{src['id']}/import").json()
    assert second["imported"] == 0 and second["skipped"] == 2


def test_import_new_objects_after_first(admin_client, fake_s3):
    fake_s3.seed("audio", {"a.mp3": 1})
    project = create_project(admin_client)
    src = create_source(admin_client, project["id"]).json()
    admin_client.post(f"/api/s3-source/{src['id']}/import")
    fake_s3.seed("audio", {"b.mp3": 2})  # a new object appeared
    res = admin_client.post(f"/api/s3-source/{src['id']}/import").json()
    assert res["imported"] == 1 and res["skipped"] == 1


def test_import_mos_project_inherits_type(admin_client, db_session, fake_s3):
    fake_s3.seed("audio", {"m1.wav": 5})
    project = create_project(admin_client, task_type="mos")
    src = create_source(admin_client, project["id"]).json()
    admin_client.post(f"/api/s3-source/{src['id']}/import")
    frag = db_session.execute(select(AudioFragment)).scalars().one()
    assert frag.task_type == TaskType.mos


# ---------------------------------------------------------------------------
# SBS: _a/_b pairs, unpaired, idempotency, swap tasks
# ---------------------------------------------------------------------------


def test_import_sbs_pairs_and_unpaired(admin_client, db_session, fake_s3):
    fake_s3.seed(
        "audio",
        {
            "p/clip1_a.wav": 100,
            "p/clip1_b.wav": 110,  # a full pair
            "p/clip2_a.wav": 120,  # a lonely half
            "p/solo.wav": 130,  # without _a/_b suffix
        },
    )
    project = create_project(admin_client, task_type="sbs")
    src = create_source(admin_client, project["id"], prefix="p/").json()
    res = admin_client.post(f"/api/s3-source/{src['id']}/import").json()
    assert res["imported"] == 1  # one full pair
    assert res["unpaired"] == 2  # a lonely half + an unpaired solo
    assert res["skipped"] == 0

    frag = db_session.execute(
        select(AudioFragment).where(AudioFragment.filename_b.is_not(None))
    ).scalars().one()
    assert frag.filename == "clip1_a.wav" and frag.s3_key == "p/clip1_a.wav"
    assert frag.filename_b == "clip1_b.wav" and frag.s3_key_b == "p/clip1_b.wav"
    assert frag.size_bytes == 100 and frag.size_bytes_b == 110
    assert frag.task_type == TaskType.sbs
    # K sbs tasks with a BLIND order (swap not NULL)
    swaps = db_session.execute(
        select(Task.swap).where(Task.fragment_id == frag.id)
    ).scalars().all()
    assert len(swaps) == 2 and all(s is not None for s in swaps)


def test_preview_sbs_pairs(admin_client, fake_s3):
    fake_s3.seed(
        "audio",
        {"c1_a.wav": 1, "c1_b.wav": 2, "c2_a.wav": 3, "c2_b.wav": 4, "lonely_a.wav": 5},
    )
    project = create_project(admin_client, task_type="sbs")
    src = create_source(admin_client, project["id"]).json()
    prev = admin_client.post(f"/api/s3-source/{src['id']}/preview").json()
    assert prev["pairs"] == 2
    assert prev["unpaired"] == 1  # lonely_a without a partner
    assert prev["already_imported"] == 0
    assert prev["to_import"] == 2
    # after import already_imported = 2, to_import = 0
    admin_client.post(f"/api/s3-source/{src['id']}/import")
    prev2 = admin_client.post(f"/api/s3-source/{src['id']}/preview").json()
    assert prev2["already_imported"] == 2 and prev2["to_import"] == 0 and prev2["pairs"] == 2


def test_import_sbs_idempotent(admin_client, fake_s3):
    fake_s3.seed("audio", {"c_a.wav": 1, "c_b.wav": 2})
    project = create_project(admin_client, task_type="sbs")
    src = create_source(admin_client, project["id"]).json()
    admin_client.post(f"/api/s3-source/{src['id']}/import")
    again = admin_client.post(f"/api/s3-source/{src['id']}/import").json()
    assert again["imported"] == 0 and again["skipped"] == 1


# ---------------------------------------------------------------------------
# presigned routing of a fragment with source_id
# ---------------------------------------------------------------------------


def test_presigned_routing_source_fragment(admin_client, fake_s3):
    fake_s3.seed("audio", {"rec.mp3": 42})
    project = create_project(admin_client)
    src = create_source(admin_client, project["id"]).json()
    admin_client.post(f"/api/s3-source/{src['id']}/import")
    frags = admin_client.get(f"/api/project/{project['id']}/fragments").json()["items"]
    assert len(frags) == 1
    frag = frags[0]
    assert frag["source_id"] == src["id"]  # fragment marked with the source
    # audio_url — presigned against the SOURCE (fake), not /api/media/
    assert frag["audio_url"] == "https://fake-s3/audio/rec.mp3?exp=3600"
    # the /fragment/{id}/presigned endpoint — same routing
    pres = admin_client.get(f"/api/fragment/{frag['id']}/presigned").json()
    assert pres["url"] == "https://fake-s3/audio/rec.mp3?exp=3600"


def test_presigned_routing_sbs_source_fragment(admin_client, fake_s3):
    fake_s3.seed("audio", {"c_a.wav": 1, "c_b.wav": 2})
    project = create_project(admin_client, task_type="sbs")
    src = create_source(admin_client, project["id"]).json()
    admin_client.post(f"/api/s3-source/{src['id']}/import")
    frag = admin_client.get(f"/api/project/{project['id']}/fragments").json()["items"][0]
    assert frag["audio_url"] == "https://fake-s3/audio/c_a.wav?exp=3600"
    assert frag["audio_url_b"] == "https://fake-s3/audio/c_b.wav?exp=3600"


def test_task_random_payload_source_urls(admin_client, admin_user, fake_s3):
    fake_s3.seed("audio", {"c_a.wav": 1, "c_b.wav": 2})
    project = create_project(admin_client, task_type="sbs")
    src = create_source(admin_client, project["id"]).json()
    admin_client.post(f"/api/s3-source/{src['id']}/import")
    # admin is not restricted by membership — takes a project task
    task = admin_client.get(f"/api/task/random?project_id={project['id']}").json()
    urls = {task["payload"]["audio_url_1"], task["payload"]["audio_url_2"]}
    assert urls == {"https://fake-s3/audio/c_a.wav?exp=3600", "https://fake-s3/audio/c_b.wav?exp=3600"}


def test_app_storage_fragment_still_local(admin_client, fake_s3):
    """An app-storage fragment (source_id=NULL) serves /api/media/,
    not the source — routing does not break regular uploads."""
    WAV = b"RIFF" + (36).to_bytes(4, "little") + b"WAVE" + b"fmt " + b"\x00" * 64
    project = create_project(admin_client)
    resp = admin_client.post(
        "/api/file/batch",
        data={"project_id": str(project["id"]), "conflict": "rename"},
        files=[("files", ("local.wav", WAV, "audio/wav"))],
    )
    assert resp.status_code == 200, resp.text
    frag = admin_client.get(f"/api/project/{project['id']}/fragments").json()["items"][0]
    assert frag["audio_url"].startswith("/api/media/")
    assert frag["source_id"] is None  # app storage


# ---------------------------------------------------------------------------
# Cascading deletion of a source
# ---------------------------------------------------------------------------


def test_delete_source_cascades_fragments(admin_client, db_session, fake_s3):
    fake_s3.seed("audio", {"a.mp3": 1, "b.mp3": 2})
    project = create_project(admin_client, consensus_overlap=2)
    src = create_source(admin_client, project["id"]).json()
    admin_client.post(f"/api/s3-source/{src['id']}/import")
    assert db_session.scalar(select(func.count()).select_from(AudioFragment)) == 2
    assert db_session.scalar(select(func.count()).select_from(Task)) == 4

    resp = admin_client.delete(f"/api/s3-source/{src['id']}")
    assert resp.status_code == 204
    db_session.expire_all()
    assert db_session.scalar(select(func.count()).select_from(S3Source)) == 0
    assert db_session.scalar(select(func.count()).select_from(AudioFragment)) == 0
    assert db_session.scalar(select(func.count()).select_from(Task)) == 0


def test_delete_source_not_found(admin_client):
    resp = admin_client.delete("/api/s3-source/424242")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "s3_source_not_found"


def test_source_storage_head_returns_size(fake_s3, db_session):
    """get_source_storage(source).head(key) returns the object's size (ContentLength)."""
    from src.storage import get_source_storage

    fake_s3.seed("audio", {"h.mp3": 777})
    source = S3Source(
        project_id=1, name="s", endpoint_url="http://minio:9000", bucket="audio",
        prefix="", access_key="k", secret_key="x", path_style=True,
    )
    assert get_source_storage(source).head("h.mp3") == 777
