"""
Бэкап файлов MinIO: все объекты бакета пишутся в tar.gz-поток на stdout.

Запускается из scripts/backup.sh внутри backend-контейнера (там уже есть
minio-клиент и ключи из .env.prod), а архив принимает хост:

    docker compose -f docker-compose.prod.yml exec -T backend \
        python -m app.backup_minio > minio.tar.gz

previews/ пропускаем: это кэш PDF-предпросмотров, он пересоздаётся сам.
Сводка (сколько объектов/байт) — в stderr, чтобы не испортить архив.
"""
import sys
import tarfile

from .storage import MINIO_BUCKET, minio_client

SKIP_PREFIXES = ("previews/",)


def main() -> None:
    count = 0
    total = 0
    with tarfile.open(fileobj=sys.stdout.buffer, mode="w|gz") as tar:
        client = minio_client()
        for obj in client.list_objects(MINIO_BUCKET, recursive=True):
            if obj.is_dir or obj.object_name.startswith(SKIP_PREFIXES):
                continue
            resp = client.get_object(MINIO_BUCKET, obj.object_name)
            try:
                info = tarfile.TarInfo(name=obj.object_name)
                info.size = obj.size
                if obj.last_modified:
                    info.mtime = obj.last_modified.timestamp()
                tar.addfile(info, resp)
            finally:
                resp.close()
                resp.release_conn()
            count += 1
            total += obj.size
    print(f"minio: {count} objects, {total} bytes", file=sys.stderr)


if __name__ == "__main__":
    main()
