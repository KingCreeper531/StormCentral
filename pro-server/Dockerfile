# Storm Central pro data server (processor). Multi-arch: builds on linux/amd64 and
# linux/arm64 (Oracle Ampere A1) - every dependency ships a manylinux wheel for
# both, and --only-binary makes the build fail fast instead of compiling.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # fewer glibc malloc arenas = less fragmentation with dask threads
    MALLOC_ARENA_MAX=2

WORKDIR /app
COPY requirements.txt .
RUN pip install --only-binary=:all: -r requirements.txt

COPY pro_server ./pro_server

RUN useradd --system --uid 10001 --home-dir /data/work --no-create-home app \
 && mkdir -p /data/output /data/work \
 && chown -R app:app /data
USER app

ENV OUTPUT_DIR=/data/output \
    WORK_DIR=/data/work \
    HOME=/data/work

# Healthy while index.json keeps being rewritten (every POLL_SECONDS).
HEALTHCHECK --interval=2m --timeout=10s --start-period=10m \
  CMD python -c "import os,sys,time; sys.exit(0 if time.time()-os.path.getmtime('/data/output/index.json') < 900 else 1)"

CMD ["python", "-m", "pro_server"]
