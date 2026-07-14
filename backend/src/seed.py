"""DB initialization at startup (after alembic upgrade head):

    cd backend && .venv/bin/python -m src.seed

By default creates ONLY the primary super-admin from the env settings
(SUPERUSER_LOGIN / SUPERUSER_PASSWORD / SUPERUSER_FIO) — idempotently.
Demo data (projects, labelers, MOS/SBS showcases) is added ONLY when
SEED_DEMO=true — the production stack comes up empty, without demo projects.

Consensus mechanism in the demo: «Радио-архив 2024» and «Оценка синтеза TTS» have
consensus_overlap=2; each TTS/SBS fragment pair has 2 done tasks from different
users (finished when done >= 2, export by majority).
"""

import random
from datetime import timedelta

from sqlalchemy import select

from src.auth import hash_password
from src.config import settings
from src.db import SessionLocal
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

# Shared password for demo labelers (used only when SEED_DEMO=true)
USER_PASSWORD = "User12345"

# Default permissions for labelers: transcription/classification allowed by the
# user, segmentation — blocked by the admin (demo of the permissions matrix)
_DEFAULT_PERMS = {
    TaskType.transcription.value: "user_allow",
    TaskType.verification.value: "user_allow",
    TaskType.classification.value: "user_allow",
}

_LABELERS = [
    # (login, fio, group, permissions override)
    ("ivolgina", "Иволгина Мария Андреевна", "БВТ2101", None),
    ("skvortsov", "Скворцов Пётр Ильич", "БВТ2101", None),
    ("sinitsyna", "Синицына Анна Олеговна", "БВТ2102", None),
    ("drozdov", "Дроздов Никита Сергеевич", "БВТ2102", {**_DEFAULT_PERMS, TaskType.segmentation.value: "admin_block"}),
    ("chaikina", "Чайкина Дарья Максимовна", "БВТ2103", None),
    ("golubev", "Голубев Артём Викторович", "БВТ2103", None),
    ("lastochkina", "Ласточкина Ольга Дмитриевна", "БИН2201", {**_DEFAULT_PERMS, TaskType.diarization.value: "admin_allow"}),
    ("sokolovsky", "Соколовский Иван Павлович", "БИН2201", None),
    ("zhuravleva", "Журавлёва Елена Романовна", "БИН2202", None),
    ("vorobyev", "Воробьёв Максим Егорович", "БИН2202", {**_DEFAULT_PERMS, TaskType.transcription.value: "user_block"}),
]

_PROJECTS = [
    {
        "name": "Радио-архив 2024",
        "description": "Оцифрованный архив радиоэфиров за 2024 год: новости, интервью, реклама.",
        "task_type": TaskType.transcription,
        # Consensus demo: each fragment is labeled by 2 different labelers
        "consensus_overlap": 2,
        "instruction": (
            "Транскрибируйте речь дословно, без нормализации чисел. "
            "Неразборчивые фрагменты помечайте тегом [unk]. "
            "ASR-черновик (orig_trb) можно править, а не набирать с нуля."
        ),
        "label_list": [
            {"name": "речь", "color": "#D9D4F7"},
            {"name": "музыка", "color": "#E8604C"},
            {"name": "шум", "color": "#9AA0AB"},
            {"name": "тишина", "color": "#8B7BF0"},
        ],
    },
    {
        "name": "Колл-центр Q2",
        "description": "Записи звонков колл-центра за второй квартал: классификация тематик и эмоций.",
        "task_type": TaskType.classification,
        "instruction": "Выберите один класс на фрагмент. При спорных случаях — «другое» и комментарий.",
        "label_list": [
            {"name": "жалоба", "color": "#E8604C"},
            {"name": "консультация", "color": "#6D5AE6"},
            {"name": "продажа", "color": "#D9D4F7"},
            {"name": "другое", "color": "#9AA0AB"},
        ],
    },
    {
        "name": "Подкасты 2023",
        "description": "Диаризация многоголосых подкастов: сегментация по спикерам.",
        "task_type": TaskType.diarization,
        "instruction": "Размечайте границы реплик по спикерам; паузы < 0.3 с не разрывать.",
        "label_list": [
            {"name": "спикер 1", "color": "#6D5AE6"},
            {"name": "спикер 2", "color": "#E8604C"},
            {"name": "спикер 3", "color": "#D9D4F7"},
            {"name": "перекрытие", "color": "#9AA0AB"},
        ],
    },
]


def _seed_mos_project(db, labelers: list[User]) -> None:
    """MOS-rating demo project: «Оценка синтеза TTS» (task_type='mos',
    consensus_overlap=2), TWO configurable scales («Качество звучания»
    with custom item labels and «Естественность» with default ones),
    4 fragments; two of them have TWO submitted mos tasks each from different
    labelers in the {scores: {scale: 1..5}} format (consensus demo: done >= 2 →
    finished), the rest have 2 open tasks each for /task/random."""
    project = Project(
        name="Оценка синтеза TTS",
        description="Субъективная оценка качества синтезированной речи по шкале MOS 1–5.",
        task_type=TaskType.mos,
        consensus_overlap=2,
        instruction=(
            "Прослушайте фрагмент целиком и поставьте оценку 1–5 по КАЖДОЙ "
            "шкале: «Качество звучания» (разборчивость, артефакты синтеза) "
            "и «Естественность» (похожесть на живую речь, интонация)."
        ),
        label_list=[],
        # Configurable MOS scales: the first has custom item labels,
        # the second uses default labels (localized on the frontend, not stored)
        mos_scales=[
            {
                "name": "Качество звучания",
                "labels": {
                    "1": "сплошные артефакты",
                    "2": "сильные искажения",
                    "3": "заметные искажения",
                    "4": "лёгкие искажения",
                    "5": "чистое звучание",
                },
            },
            {"name": "Естественность"},
        ],
    )
    project.participants = labelers[:4]
    db.add(project)
    db.flush()  # get project.id for s3_key

    fragments = [
        AudioFragment(
            project_id=project.id,
            filename=f"tts_{i:04d}.wav",
            s3_key=f"project_{project.id}/seed/tts_{i:04d}.wav",
            size_bytes=160_000 + i,
            duration_sec=3.0 + i * 0.5,
            task_type=TaskType.mos,  # inherits the project type
            meta={"voice": "demo-tts-v2", "batch": "seed"},
        )
        for i in range(1, 5)
    ]
    db.add_all(fragments)
    db.flush()

    now = utcnow()

    def done_task(fragment, user, quality: int, naturalness: int, minutes_ago: int) -> Task:
        # result per the contract {type: 'mos', scores: {scale_name: 1..5}} —
        # a rating for EACH scale of the project
        return Task(
            fragment_id=fragment.id,
            user_id=user.id,
            status=TaskStatus.done,
            result={
                "type": TaskType.mos.value,
                "scores": {"Качество звучания": quality, "Естественность": naturalness},
            },
            started_at=now - timedelta(minutes=minutes_ago + 2),
            finished_at=now - timedelta(minutes=minutes_ago),
        )

    # Consensus demo (K=2): a pair of fragments has 2 done tasks each from
    # DIFFERENT labelers — fragments[0] with matching ratings (100% agreement),
    # fragments[1] with differing ones (export majority: on a tie the later
    # submission wins)
    db.add_all(
        [
            done_task(fragments[0], labelers[0], quality=4, naturalness=5, minutes_ago=8),
            done_task(fragments[0], labelers[1], quality=4, naturalness=5, minutes_ago=6),
            done_task(fragments[1], labelers[1], quality=5, naturalness=4, minutes_ago=5),
            done_task(fragments[1], labelers[2], quality=3, naturalness=3, minutes_ago=3),
        ]
    )
    # Open tasks for the unrated fragments: K=2 per fragment
    db.add_all(
        Task(fragment_id=fragment.id, status=TaskStatus.open)
        for fragment in (fragments[2], fragments[3])
        for _ in range(2)
    )


def _seed_sbs_project(db, labelers: list[User]) -> None:
    """Side-by-Side demo project: «Сравнение TTS-движков» (task_type='sbs',
    consensus_overlap=2) with CUSTOM system names; 3 fragment PAIRS.
    The first pair has TWO submitted sbs tasks from different labelers (consensus
    demo: preference normalized in terms of the systems, minus = A better),
    the rest have 2 open sbs tasks each with a blind Task.swap order."""
    project = Project(
        name="Сравнение TTS-движков",
        description="Слепое парное сравнение двух TTS-движков (A/B) по шкале предпочтения.",
        task_type=TaskType.sbs,
        consensus_overlap=2,
        instruction=(
            "Прослушайте оба варианта и выберите, какой звучит лучше, "
            "по 5-балльной шкале предпочтения (Вариант 1 ↔ одинаково ↔ Вариант 2). "
            "Порядок вариантов случаен, названия движков скрыты."
        ),
        label_list=[],
        # Custom system names — visible ONLY to the admin (card/export)
        sbs_systems={"a": "YourTTS", "b": "XTTS-v2"},
    )
    project.participants = labelers[:4]
    db.add(project)
    db.flush()  # get project.id for s3_key

    # An sbs fragment — a PAIR of files <base>_a.wav / <base>_b.wav (one AudioFragment)
    fragments = [
        AudioFragment(
            project_id=project.id,
            filename=f"sbs_{i:04d}_a.wav",
            s3_key=f"project_{project.id}/seed/sbs_{i:04d}_a.wav",
            size_bytes=150_000 + i,
            duration_sec=3.0 + i * 0.4,
            filename_b=f"sbs_{i:04d}_b.wav",
            s3_key_b=f"project_{project.id}/seed/sbs_{i:04d}_b.wav",
            size_bytes_b=152_000 + i,
            duration_sec_b=3.2 + i * 0.4,
            task_type=TaskType.sbs,  # inherits the project type
            meta={"engines": "YourTTS|XTTS-v2", "batch": "seed"},
        )
        for i in range(1, 4)
    ]
    db.add_all(fragments)
    db.flush()

    now = utcnow()

    def done_task(fragment, user, preference: int, swap: bool, minutes_ago: int) -> Task:
        # result per the contract {type:'sbs', preference: -2..2} is ALREADY
        # normalized in terms of the systems (minus = A/YourTTS better, plus = B/XTTS-v2 better)
        return Task(
            fragment_id=fragment.id,
            user_id=user.id,
            status=TaskStatus.done,
            swap=swap,
            result={"type": TaskType.sbs.value, "preference": preference},
            started_at=now - timedelta(minutes=minutes_ago + 2),
            finished_at=now - timedelta(minutes=minutes_ago),
        )

    # Consensus demo (K=2): the first pair has 2 done tasks from DIFFERENT labelers
    # with a matching normalized preference (-1 → A slightly better)
    db.add_all(
        [
            done_task(fragments[0], labelers[0], preference=-1, swap=False, minutes_ago=9),
            done_task(fragments[0], labelers[1], preference=-1, swap=True, minutes_ago=6),
        ]
    )
    # Open sbs tasks for the remaining pairs: K=2, each with its own blind order
    db.add_all(
        Task(fragment_id=fragment.id, status=TaskStatus.open, swap=random.choice((False, True)))
        for fragment in (fragments[1], fragments[2])
        for _ in range(2)
    )


def bootstrap_superuser(db) -> User:
    """Create the primary super-admin from the env settings if it does not yet exist.
    Idempotent: on a repeated run returns the existing one."""
    login = settings.SUPERUSER_LOGIN
    existing = db.execute(select(User).where(User.login == login)).scalar_one_or_none()
    if existing is not None:
        return existing
    super_admin = User(
        login=login,
        password_hash=hash_password(settings.SUPERUSER_PASSWORD),
        fio=settings.SUPERUSER_FIO,
        role=UserRole.admin,
        can_add_admins=True,
        permissions={},
    )
    db.add(super_admin)
    db.flush()
    return super_admin


def seed_demo(db) -> None:
    """Demo population (only when SEED_DEMO=true): 2 admins, 10 labelers,
    transcription/classification/diarization projects + MOS and SBS showcases.
    Skipped if the demo labeler 'ivolgina' already exists (idempotency)."""
    if db.execute(select(User).where(User.login == "ivolgina")).scalar_one_or_none():
        print("Демо-данные уже загружены — пропуск.")
        return

    admin_hash = hash_password("Admin12345")
    user_hash = hash_password(USER_PASSWORD)

    admins = [
        User(login="akim", password_hash=admin_hash, fio="Ким Анна Владимировна",
             role=UserRole.admin, can_add_admins=False, permissions={}),
        User(login="porlov", password_hash=admin_hash, fio="Орлов Павел Сергеевич",
             role=UserRole.admin, can_add_admins=False, permissions={}),
    ]
    labelers = [
        User(
            login=login,
            password_hash=user_hash,
            fio=fio,
            role=UserRole.user,
            group_name=group,
            permissions=perms if perms is not None else dict(_DEFAULT_PERMS),
        )
        for login, fio, group, perms in _LABELERS
    ]
    db.add_all(admins)
    db.add_all(labelers)

    for i, data in enumerate(_PROJECTS):
        project = Project(**data)
        project.participants = labelers[i * 2 : i * 2 + 6] or labelers
        db.add(project)

    _seed_mos_project(db, labelers)
    _seed_sbs_project(db, labelers)
    print(
        f"Демо: {len(admins)} админа, {len(labelers)} разметчиков, "
        f"{len(_PROJECTS) + 2} проекта (+MOS/SBS-витрины)."
    )


def seed() -> None:
    """Initialization at startup: super-admin from env always; demo — when SEED_DEMO."""
    db = SessionLocal()
    try:
        bootstrap_superuser(db)
        if settings.SEED_DEMO:
            seed_demo(db)
        db.commit()
        mode = "с демо-данными" if settings.SEED_DEMO else "без демо (только супер-админ)"
        print(f"Готово ({mode}). Супер-админ: {settings.SUPERUSER_LOGIN}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
