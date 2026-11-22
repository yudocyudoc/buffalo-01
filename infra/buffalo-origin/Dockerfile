# Build context MUST be the repository root:
#   docker build -f infra/buffalo-origin/Dockerfile .
# No image is built/deployed by this PR. Pin image digest before first deploy.
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node . .
USER node
EXPOSE 8080
CMD ["node", "infra/buffalo-origin/origin-server.mjs"]
