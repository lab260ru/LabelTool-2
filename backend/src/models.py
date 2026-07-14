"""ALL LabelTool 2 data models.

The schema covers: users with
permissions per task type, projects with an instruction and label_list,
audio fragments with metadata, labeling tasks, export, and
batch-upload sessions.
"""

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class UserRole(str, enum.Enum):
    user = "user"
    admin = "admin"


class TaskType(str, enum.Enum):
    """7 labeling task types, including MOS rating and SBS comparison.

    The task type is a PROJECT attribute
    (Project.task_type), and fragments inherit it automatically.
    """

    transcription = "transcription"
    verification = "verification"
    classification = "classification"
    segmentation = "segmentation"
    diarization = "diarization"
    # MOS rating: subjective audio quality on a 1–5 scale
    # (Mean Opinion Score) using the project's configurable scales
    # (Project.mos_scales), the task result — {"scores": {scale_name: 1..5}};
    # legacy results {"score": 1..5} remain readable (the export
    # treats them as {"scores": {"MOS": N}})
    mos = "mos"
    # Side-by-Side: blind pairwise comparison of two audio variants (A/B,
    # e.g. two TTS engines). A fragment is a PAIR of files (filename/filename_b),
    # the task shows them in a blind order (Task.swap), and the result is stored
    # NORMALIZED in terms of the systems: {"preference": -2..2}
    # (minus = A better, plus = B better, 0 — equal)
    sbs = "sbs"


class TaskStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    done = "done"
    skipped = "skipped"


class ExportFormat(str, enum.Enum):
    """6 export formats."""

    jsonl = "jsonl"
    csv = "csv"
    nemo = "nemo"
    textgrid = "textgrid"
    conll = "conll"
    srt_vtt = "srt_vtt"


class ExportScope(str, enum.Enum):
    consensus = "consensus"
    all = "all"


class ExportStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    done = "done"
    error = "error"


def _enum(e: type[enum.Enum], **kw) -> Enum:
    """Portable string enum (VARCHAR + CHECK, without a native PG enum)."""
    return Enum(e, native_enum=False, validate_strings=True, values_callable=lambda x: [i.value for i in x], **kw)


# Default MOS project scale: set when creating a mos project without explicit
# scales (and backfilled by a migration for existing mos projects). The 1..5 item
# labels are not stored — the defaults are localized by the frontend, only custom
# ones live in the data. Read only via a copy ([dict(s) for s in DEFAULT_MOS_SCALES])
# — the list is mutable.
DEFAULT_MOS_SCALES: list[dict] = [{"name": "Качество звучания"}]

# Default SBS project system names (Project.sbs_systems): set when creating an
# sbs project without explicit names. Visible ONLY to the admin (project card,
# export) — the system names are NEVER shown to the labeler (blind comparison).
# Read only via a copy (dict(DEFAULT_SBS_SYSTEMS)) — the dict is mutable.
DEFAULT_SBS_SYSTEMS: dict[str, str] = {"a": "Система A", "b": "Система B"}


# ---------------------------------------------------------------------------
# M2M: project participants
# ---------------------------------------------------------------------------

project_participants = Table(
    "project_participants",
    Base.metadata,
    Column("project_id", ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
)


# ---------------------------------------------------------------------------
# User
# ---------------------------------------------------------------------------

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    login: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    fio: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(_enum(UserRole), default=UserRole.user, nullable=False)
    # Super-admin flag (meaningful only when role=admin)
    can_add_admins: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    group_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Permissions per task type: {task_type: 'user_allow'|'user_block'|'admin_allow'|'admin_block'}
    permissions: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    projects: Mapped[list["Project"]] = relationship(
        secondary=project_participants, back_populates="participants"
    )
    tasks: Mapped[list["Task"]] = relationship(back_populates="user")

    @property
    def is_admin(self) -> bool:
        return self.role == UserRole.admin

    @property
    def is_super_admin(self) -> bool:
        return self.role == UserRole.admin and self.can_add_admins


# ---------------------------------------------------------------------------
# Project
# ---------------------------------------------------------------------------

class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Instruction for the labeler
    instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Labeling classes: [{"name": "speech", "color": "#D9D4F7"}, ...]
    label_list: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    # Project task type: chosen AT CREATION and applies to all fragments.
    # AudioFragment.task_type inherits this value.
    # server_default — backfill of existing rows (finalized by a migration).
    task_type: Mapped[TaskType] = mapped_column(
        _enum(TaskType),
        default=TaskType.transcription,
        server_default=TaskType.transcription.value,
        nullable=False,
    )
    # Consensus overlap: how many DIFFERENT labelers must label EACH fragment
    # (1 = no consensus, 2-3 — typical consensus; the 1..5 validation is at the
    # schema level). consensus_overlap open tasks are created per fragment;
    # a fragment is finished when the number of done tasks >= consensus_overlap.
    # server_default='1' — backfill of existing projects without changing behavior.
    consensus_overlap: Mapped[int] = mapped_column(
        Integer, default=1, server_default="1", nullable=False
    )
    # Configurable MOS scales (only for task_type='mos', NULL for the rest):
    # [{"name": str, "labels"?: {"1".."5": str}}], 1..5 scales, names are unique.
    # The rating scale is always 1–5 (MOS standard); the name and labels are configurable.
    # The default when creating a mos project is DEFAULT_MOS_SCALES.
    mos_scales: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # SBS comparison system names (only for task_type='sbs', NULL for the rest):
    # {"a": str, "b": str}. A label for the admin/export; the names are NEVER
    # given to the labeler (blind comparison). The default is DEFAULT_SBS_SYSTEMS.
    sbs_systems: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    participants: Mapped[list[User]] = relationship(
        secondary=project_participants, back_populates="projects"
    )
    fragments: Mapped[list["AudioFragment"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    export_jobs: Mapped[list["ExportJob"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    upload_sessions: Mapped[list["UploadSession"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    # S3 data sources (reference-in-place): deleting a project cascades to
    # delete its sources (their fragments go via Project.fragments)
    s3_sources: Mapped[list["S3Source"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# Audio fragment
# ---------------------------------------------------------------------------

class AudioFragment(Base):
    __tablename__ = "audio_fragments"
    __table_args__ = (
        Index("ix_audio_fragments_project_filename", "project_id", "filename"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    s3_key: Mapped[str] = mapped_column(String(1024), unique=True, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duration_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Variant B of the SBS comparison pair (only in sbs projects, NULL for the
    # rest; the regular fields above are variant A). An sbs project fragment = a
    # PAIR of files <base>_a.<ext> + <base>_b.<ext>, created as ONE per pair.
    filename_b: Mapped[str | None] = mapped_column(String(512), nullable=True)
    s3_key_b: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    size_bytes_b: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_sec_b: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Inherited from Project.task_type at upload (the field is kept in the schema
    # for a minimal migration; the type is uniform across the project)
    task_type: Mapped[TaskType] = mapped_column(_enum(TaskType), nullable=False, index=True)
    # ASR hint, shown to the labeler as a draft
    orig_trb: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Key-value metadata of the batch/file: {"source": "radio", ...}
    meta: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    # Data source (reference-in-place): NULL = application storage (as before,
    # s3_key is a key in the application bucket); otherwise the object lives in
    # the S3Source bucket, s3_key/s3_key_b are the object keys THERE, and the
    # presigned URL is generated against the source. ondelete CASCADE: deleting a
    # source deletes its fragments (see routers/s3_source.py delete_s3_source).
    source_id: Mapped[int | None] = mapped_column(
        ForeignKey("s3_sources.id", ondelete="CASCADE"), index=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    project: Mapped[Project] = relationship(back_populates="fragments")
    source: Mapped["S3Source | None"] = relationship(back_populates="fragments")
    tasks: Mapped[list["Task"]] = relationship(back_populates="fragment", cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
# S3 data source (connection to an external bucket, reference-in-place)
# ---------------------------------------------------------------------------

class S3Source(Base):
    """A project's data source: an external S3/MinIO bucket whose objects are
    IMPORTED by reference (reference-in-place) — the bytes are not copied into
    the application storage, and the presigned URL is generated against this
    source (see storage.get_source_storage, routers/s3_source.py).

    secret_key — WRITE ONLY: stored as the user's infrastructure config
    (like S3_SECRET in config.py), but NEVER returned in the API and not
    written to logs (see schemas/s3_source.py — it is not in S3SourceOut).
    path_style=true — path-style bucket addressing (needed by MinIO).
    """

    __tablename__ = "s3_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    endpoint_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    bucket: Mapped[str] = mapped_column(String(255), nullable=False)
    # Listing prefix within the bucket (may be '' — the whole bucket)
    prefix: Mapped[str] = mapped_column(String(1024), default="", server_default="", nullable=False)
    access_key: Mapped[str] = mapped_column(String(255), nullable=False)
    # WRITE ONLY — not exposed in the API/logs (see the class docstring)
    secret_key: Mapped[str] = mapped_column(String(512), nullable=False)
    region: Mapped[str | None] = mapped_column(String(64), nullable=True)
    path_style: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    project: Mapped[Project] = relationship(back_populates="s3_sources")
    # Fragments referencing the source. The cascade deletion of fragments when a
    # source is deleted is done EXPLICITLY in routers/s3_source.py (like DELETE
    # fragment, but without deleting external objects) + a DB-level ondelete
    # CASCADE (audio_fragments.source_id) — here the relationship has no delete
    # cascade so a fragment is not orphaned across two parents (project + source).
    fragments: Mapped[list["AudioFragment"]] = relationship(back_populates="source")


# ---------------------------------------------------------------------------
# Labeling task
# ---------------------------------------------------------------------------

class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        Index("ix_tasks_user_status", "user_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    fragment_id: Mapped[int] = mapped_column(
        ForeignKey("audio_fragments.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    status: Mapped[TaskStatus] = mapped_column(
        _enum(TaskStatus), default=TaskStatus.open, nullable=False, index=True
    )
    # Labeling result: the structure depends on the fragment's task_type
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Blind order of the SBS task (only sbs, NULL for the rest): randomized when
    # creating each of the K tasks. swap=false: variant 1 = A, 2 = B;
    # swap=true: 1 = B, 2 = A. The payload returns audio_url_1/2 ALREADY taking
    # swap into account; submit normalizes preference back into system terms.
    swap: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    fragment: Mapped[AudioFragment] = relationship(back_populates="tasks")
    user: Mapped[User | None] = relationship(back_populates="tasks")


# ---------------------------------------------------------------------------
# Dataset export
# ---------------------------------------------------------------------------

class ExportJob(Base):
    __tablename__ = "export_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    format: Mapped[ExportFormat] = mapped_column(_enum(ExportFormat), nullable=False)
    scope: Mapped[ExportScope] = mapped_column(
        _enum(ExportScope), default=ExportScope.consensus, nullable=False
    )
    include_metadata: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[ExportStatus] = mapped_column(
        _enum(ExportStatus), default=ExportStatus.pending, nullable=False, index=True
    )
    progress: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)  # 0.0..1.0
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    file_key: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    project: Mapped[Project] = relationship(back_populates="export_jobs")


# ---------------------------------------------------------------------------
# Batch-upload session
# ---------------------------------------------------------------------------

class UploadSession(Base):
    __tablename__ = "upload_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    succeeded: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    project: Mapped[Project] = relationship(back_populates="upload_sessions")
    user: Mapped[User | None] = relationship()
