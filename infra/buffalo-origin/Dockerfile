# Build context MUST be the repository root.
# The CI gate supplies a digest-pinned Node 22 base and the exact checkout SHA:
#   docker buildx build --build-arg NODE_BASE_IMAGE=node:22-bookworm-slim@sha256:<verified> \
#     --build-arg BUFFALO_IMAGE_SOURCE_SHA=<verified-git-sha> \
#     -f infra/buffalo-origin/Dockerfile .
# This image remains handshake-only. Build does not authorize deployment.
ARG NODE_BASE_IMAGE
FROM ${NODE_BASE_IMAGE}
# Identity below is a claim checked against GitHub CI metadata, NOT independent attestation.
ARG BUFFALO_IMAGE_SOURCE_SHA
RUN node -e "if(!/^[a-f0-9]{40}$/.test(process.argv[1]||''))process.exit(1)" "$BUFFALO_IMAGE_SOURCE_SHA"
ENV NODE_ENV=production
ENV BUFFALO_IMAGE_SOURCE_SHA=${BUFFALO_IMAGE_SOURCE_SHA}
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node . .
USER node
EXPOSE 8080
CMD ["node", "infra/buffalo-origin/origin-server.mjs"]
