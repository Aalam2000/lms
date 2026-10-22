"""
Файлы платформы — единая точка входа для записи, чтения и удаления.

Файлы лежат на диске в STORAGE_DIR (по умолчанию /var/lib/logacademy/data)
под путём «<тип>/<uuid>», предпросмотры — «previews/<uuid>.pdf». Имён файлов
на диске нет: настоящее имя, владелец и привязки — только в базе платформы.
Доступ к файлам — только через платформу.
"""
import os
import re
import uuid
from pathlib import Path

STORAGE_DIR = Path(os.getenv("STORAGE_DIR", "/var/lib/logacademy/data"))

# Путь файла: «materials/<uuid>», «previews/<uuid>.pdf» и т.п.
_KEY = re.compile(r"^[a-z][a-z-]*/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.pdf)?$")

CHUNK = 32 * 1024


def new_key(kind: str) -> str:
    """Путь нового файла: «materials/<uuid>», «homework-answers/<uuid>»…"""
    key = f"{kind}/{uuid.uuid4()}"
    if not _KEY.match(key):
        raise ValueError(f"недопустимый тип файла: {kind!r}")
    return key


def _path(object_key: str) -> Path:
    if not _KEY.match(object_key):
        raise ValueError(f"недопустимый путь файла: {object_key!r}")
    return STORAGE_DIR / object_key


def upload_bytes(object_key: str, data: bytes, content_type: str | None = None) -> None:
    """Запись через временный файл рядом: файл на месте либо целиком, либо никак.
    content_type хранится в базе, здесь не нужен."""
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


def exists(object_key: str) -> bool:
    """Есть ли файл на диске. Проверять до StreamingResponse: stream_object
    открывает файл уже после отправки заголовков, и без файла ответ
    обрывается на середине (в браузере — ERR_INCOMPLETE_CHUNKED_ENCODING)."""
    return _path(object_key).is_file()


def stream_object(object_key: str, chunk_size: int = CHUNK):
    with open(_path(object_key), "rb") as f:
        while chunk := f.read(chunk_size):
            yield chunk


def read_object_or_none(object_key: str) -> bytes | None:
    """Файл целиком или None, если его нет (для кэша предпросмотра)."""
    try:
        return _path(object_key).read_bytes()
    except FileNotFoundError:
        return None


# Кэш PDF-предпросмотра docx/xlsx/pptx (materials.py). Путь файла уникален и
# никогда не перезаписывается (новая загрузка = новый путь), поэтому PDF,
# привязанный к пути, не устаревает.
def preview_key(object_key: str) -> str:
    return f"previews/{object_key.rsplit('/', 1)[1]}.pdf"


def delete_object(object_key: str) -> None:
    """Удаление файла вместе с его PDF-предпросмотром; отсутствие — не ошибка."""
    _path(object_key).unlink(missing_ok=True)
    if not object_key.startswith("previews/"):
        _path(preview_key(object_key)).unlink(missing_ok=True)
