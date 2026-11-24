# R1: minimal private namespace probe. No Buffalo, npm packages or provider SDK.
ARG NODE_BASE_IMAGE
FROM ${NODE_BASE_IMAGE}
ARG BUFFALO_IMAGE_SOURCE_SHA
RUN echo "$BUFFALO_IMAGE_SOURCE_SHA" | grep -Eq '^[a-f0-9]{40}$' \
 && apt-get update -qq \
 && apt-get install -y --no-install-recommends bubblewrap \
 && rm -rf /var/lib/apt/lists/* \
 && test -x /usr/bin/bwrap
ENV BUFFALO_IMAGE_SOURCE_SHA=${BUFFALO_IMAGE_SOURCE_SHA} ALLOW_UNSANDBOXED_FALLBACK=false NODE_ENV=production
WORKDIR /app
COPY --chown=node:node infra/buffalo-origin/stage3b8r-bwrap-minimal.mjs ./stage3b8r-bwrap-minimal.mjs
COPY --chown=node:node infra/buffalo-r1/receipt.mjs infra/buffalo-r1/server.mjs ./
USER node
EXPOSE 8080
CMD ["node","server.mjs"]
