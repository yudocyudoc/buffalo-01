FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
RUN pip install --no-cache-dir --only-binary=:all: pysimlin==0.8.5
COPY evals/categories/feedbackExplanationData/ /reference/
COPY infra/full-runtime/ltm-benchmark/ /benchmark/
RUN python /benchmark/test_benchmark.py
USER 65532:65532
ENTRYPOINT ["python","/benchmark/benchmark.py"]
