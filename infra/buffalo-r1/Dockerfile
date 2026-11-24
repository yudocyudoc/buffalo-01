# R1: minimal private namespace probe. No Buffalo, npm packages or provider SDK.
ARG NODE_BASE_IMAGE
FROM ${NODE_BASE_IMAGE}
ARG BUFFALO_IMAGE_SOURCE_SHA
RUN echo "$BUFFALO_IMAGE_SOURCE_SHA" | grep -Eq '^[a-f0-9]{40}$' \
 && apt-get update -qq \
 && apt-get install -y --no-install-recommends bubblewrap util-linux \
 && rm -rf /var/lib/apt/lists/* \
 && test -x /usr/bin/bwrap \
 && test -x /usr/bin/setpriv \
 && /lib64/ld-linux-x86-64.so.2 --verify /usr/bin/true
ENV BUFFALO_IMAGE_SOURCE_SHA=${BUFFALO_IMAGE_SOURCE_SHA} ALLOW_UNSANDBOXED_FALLBACK=false NODE_ENV=production
WORKDIR /app/infra/buffalo-r1
COPY --chown=node:node infra/buffalo-origin/stage3b8r-bwrap-minimal.mjs ../buffalo-origin/stage3b8r-bwrap-minimal.mjs
COPY --chown=node:node infra/buffalo-r1/receipt.mjs infra/buffalo-r1/server.mjs infra/buffalo-r1/launch-bwrap.sh ./
USER node
EXPOSE 8080
CMD ["node","server.mjs"]
