FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 PYTHONPATH=/benchmark:/a1
RUN pip download --no-deps --only-binary=:all: pysimlin==0.8.5 -d /tmp/wheel \
 && echo '682162e3744dbd224709beb91df4fa36b9fc28d4753a17dd601f45127fd9f3ae  /tmp/wheel/pysimlin-0.8.5-cp311-cp311-manylinux_2_28_x86_64.whl' | sha256sum -c - \
 && pip install --no-cache-dir --only-binary=:all: /tmp/wheel/*.whl \
 && rm -rf /tmp/wheel
COPY evals/categories/feedbackExplanationData/bassDiffusion.* evals/categories/feedbackExplanationData/maibab.* /reference/
COPY infra/full-runtime/ltm-benchmark/ /benchmark/
COPY infra/full-runtime/ltm-a1/ /a1/
USER 65532:65532
