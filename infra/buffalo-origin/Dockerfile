# Build context MUST be the repository root:
#   docker build -f infra/buffalo-origin/Dockerfile .
# No image is built/deployed by this PR. Pin image digest before first deploy.
FROM node:22-bookworm-slim
# Build identity is supplied from the *verified checkout*, never the runtime.
# A distinct GitHub/image attestation must verify this build argument before use.
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
