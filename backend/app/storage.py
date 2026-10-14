"""
Файлы платформы — единая точка входа для записи, чтения и удаления.

Файлы лежат на диске в STORAGE_DIR (по умолчанию /var/lib/logacademy/data)
под путём «<тип>/<uuid>», предпросмотры — «previews/<uuid>.pdf». Имён файлов
на диске нет: настоящее имя, владелец и привязки — только в базе платформы.

Переезд с MinIO: файлы со старым путём («<тип>/…/<uuid>/<имя файла>») ещё
лежат в MinIO и читаются оттуда, пока фоновый перенос не переложит их на
диск и не поменяет путь в базе. Какое хранилище — решает вид пути, а не
поиск по обоим. После переезда работа с MinIO отсюда удаляется.
"""
import hashlib
import io
import logging
import os
import re
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)

STORAGE_DIR = Path(os.getenv("STORAGE_DIR", "/var/lib/logacademy/data"))

# Путь файла на диске: «materials/<uuid>», «previews/<uuid>.pdf» и т.п.
_LOCAL_KEY = re.compile(r"^[a-z][a-z-]*/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.pdf)?$")

CHUNK = 32 * 1024


def is_local_key(object_key: str) -> bool:
    return bool(_LOCAL_KEY.match(object_key))


def new_key(kind: str) -> str:
    """Путь нового файла: «materials/<uuid>», «homework-answers/<uuid>»…"""
    key = f"{kind}/{uuid.uuid4()}"
    if not is_local_key(key):
        raise ValueError(f"недопустимый тип файла: {kind!r}")
    return key


def _path(object_key: str) -> Path:
    if not is_local_key(object_key):
        raise ValueError(f"недопустимый путь файла: {object_key!r}")
    return STORAGE_DIR / object_key


# --- MinIO: только чтение и удаление старых путей на время переезда ---
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "")
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "logacademy")
_minio = None


def minio_client():
    global _minio
    if _minio is None:
        if not MINIO_ENDPOINT:
            raise RuntimeError("файл со старым путём, а MinIO не настроен (MINIO_ENDPOINT)")
        from minio import Minio
        _minio = Minio(
            MINIO_ENDPOINT,
            access_key=os.getenv("MINIO_ACCESS_KEY", ""),
            secret_key=os.getenv("MINIO_SECRET_KEY", ""),
            secure=os.getenv("MINIO_SECURE", "false").lower() == "true",
        )
    return _minio


def _minio_missing(e: Exception) -> bool:
    return getattr(e, "code", None) in ("NoSuchKey", "NoSuchBucket")


# --- операции ---
def upload_bytes(object_key: str, data: bytes, content_type: str | None) -> None:
    """Запись через временный файл рядом: файл на месте либо целиком, либо никак."""
    if not is_local_key(object_key):
        # Кэш предпросмотра файла, который ещё не перенесён с MinIO.
        client = minio_client()
        client.put_object(MINIO_BUCKET, object_key, io.BytesIO(data), length=len(data),
                          content_type=content_type or "application/octet-stream")
        return
    path = _path(object_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def stream_object(object_key: str, chunk_size: int = CHUNK):
    if not is_local_key(object_key):
        resp = minio_client().get_object(MINIO_BUCKET, object_key)
        try:
            for chunk in resp.stream(chunk_size):
                yield chunk
        finally:
            resp.close()
            resp.release_conn()
        return
    with open(_path(object_key), "rb") as f:
        while chunk := f.read(chunk_size):
            yield chunk


def read_object_or_none(object_key: str) -> bytes | None:
    """Файл целиком или None, если его нет (для кэша предпросмотра)."""
    try:
        return b"".join(stream_object(object_key))
    except FileNotFoundError:
        return None
    except Exception as e:
        if _minio_missing(e):
            return None
        raise


# Кэш PDF-предпросмотра docx/xlsx/pptx (materials.py). Путь файла уникален и
# никогда не перезаписывается (новая загрузка = новый путь), поэтому PDF,
# привязанный к пути, не устаревает.
def preview_key(object_key: str) -> str:
    if is_local_key(object_key):
        return f"previews/{object_key.rsplit('/', 1)[1]}.pdf"
    return f"previews/{object_key}.pdf"


def delete_object(object_key: str) -> None:
    """Удаление файла вместе с его PDF-предпросмотром; отсутствие — не ошибка."""
    if not is_local_key(object_key):
        client = minio_client()
        client.remove_object(MINIO_BUCKET, object_key)
        if not object_key.startswith("previews/"):
            client.remove_object(MINIO_BUCKET, preview_key(object_key))
        return
    _path(object_key).unlink(missing_ok=True)
    if not object_key.startswith("previews/"):
        _path(preview_key(object_key)).unlink(missing_ok=True)


# --- Перенос файлов из MinIO на диск (на время переезда) ---
# Запускается в фоне при старте backend (main.py). По одному файлу: копия из
# MinIO во временный файл → сверка размера и SHA-256 (у файлов Базы знаний —
# ещё и с content_hash из базы) → файл на место → путь в базе меняется, только
# если он прежний (файл не заменили, пока шёл перенос). Из MinIO ничего не
# удаляется. Сбой посреди — файл остаётся на старом пути, следующий запуск
# перенесёт его. Предпросмотры не переносятся: пересоздадутся сами.
def _copy_from_minio(old_key: str, new_key_: str, expected_sha: str | None) -> None:
    client = minio_client()
    size = client.stat_object(MINIO_BUCKET, old_key).size
    path = _path(new_key_)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        h = hashlib.sha256()
        written = 0
        with open(tmp, "wb") as f:
            for chunk in stream_object(old_key):
                f.write(chunk)
                h.update(chunk)
                written += len(chunk)
            f.flush()
            os.fsync(f.fileno())
        if written != size:
            raise IOError(f"размер {written} вместо {size}")
        h2 = hashlib.sha256()
        with open(tmp, "rb") as f:
            while chunk := f.read(CHUNK):
                h2.update(chunk)
        if h2.hexdigest() != h.hexdigest():
            raise IOError("файл на диске не совпадает с прочитанным из MinIO")
        if expected_sha and h.hexdigest() != expected_sha:
            raise IOError("содержимое не совпадает с content_hash в базе")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


async def migrate_from_minio() -> None:
    if not MINIO_ENDPOINT:
        return
    try:
        await _migrate_from_minio()
    except Exception:
        logger.exception("перенос из MinIO прерван — продолжится при следующем запуске")


async def _migrate_from_minio() -> None:
    import asyncio
    from sqlalchemy import select, update, func
    from .database import AsyncSessionLocal
    from .models import Material, HomeworkAnswerFile, LessonWorkFile

    def kind_of(model, row):
        if model is Material:
            return "homework-tasks" if row.is_personal else "materials"
        return "homework-answers" if model is HomeworkAnswerFile else "lesson-work"

    moved = missing = failed = 0
    for model in (Material, HomeworkAnswerFile, LessonWorkFile):
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(model))).scalars().all()
            todo = [(r.id, r.object_key, kind_of(model, r), getattr(r, "content_hash", None))
                    for r in rows if not is_local_key(r.object_key)]
        for row_id, old_key, kind, sha in todo:
            new = new_key(kind)
            try:
                await asyncio.to_thread(_copy_from_minio, old_key, new, sha)
            except Exception as e:
                if _minio_missing(e):
                    missing += 1
                    logger.warning("перенос из MinIO: нет файла %s (%s id=%s)", old_key, model.__tablename__, row_id)
                else:
                    failed += 1
                    logger.error("перенос из MinIO: ошибка %s (%s id=%s): %s", old_key, model.__tablename__, row_id, e)
                continue
            async with AsyncSessionLocal() as db:
                res = await db.execute(update(model)
                                       .where(model.id == row_id, model.object_key == old_key)
                                       .values(object_key=new))
                await db.commit()
            if res.rowcount == 1:
                moved += 1
            else:  # файл заменили или удалили, пока шёл перенос — копия не нужна
                _path(new).unlink(missing_ok=True)

    left = 0
    async with AsyncSessionLocal() as db:
        for model in (Material, HomeworkAnswerFile, LessonWorkFile):
            keys = (await db.execute(select(model.object_key))).scalars().all()
            left += sum(1 for k in keys if not is_local_key(k))
    logger.info("перенос из MinIO: перенесено %s, нет в MinIO %s, ошибок %s, осталось старых путей %s",
                moved, missing, failed, left)
