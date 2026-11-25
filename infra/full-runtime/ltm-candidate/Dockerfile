# Experimental image only; not used in the Buffalo Full runtime.
FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
RUN pip install --no-cache-dir --only-binary=:all: pysimlin==0.8.5
COPY evals/categories/feedbackExplanationData/bassDiffusion.json /reference/bassDiffusion.json
COPY evals/categories/feedbackExplanationData/bassDiffusion.stmx /reference/bassDiffusion.stmx
COPY infra/full-runtime/ltm-candidate/probe.py /probe.py
USER 65532:65532
ENTRYPOINT ["python","/probe.py"]
