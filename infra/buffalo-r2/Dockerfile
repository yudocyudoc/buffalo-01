# R2: original Buffalo process only. No deployment by this build.
ARG NODE_BASE_IMAGE
FROM ${NODE_BASE_IMAGE}
ARG BUFFALO_IMAGE_SOURCE_SHA
RUN echo "$BUFFALO_IMAGE_SOURCE_SHA" | grep -Eq '^[a-f0-9]{40}$' \
 && apt-get update -qq \
 && apt-get install -y --no-install-recommends bubblewrap util-linux ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && test -x /usr/bin/bwrap && test -x /usr/bin/setpriv \
 && /lib64/ld-linux-x86-64.so.2 --verify /usr/bin/true
ENV BUFFALO_IMAGE_SOURCE_SHA=${BUFFALO_IMAGE_SOURCE_SHA} ALLOW_UNSANDBOXED_FALLBACK=false NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node . .
USER node
EXPOSE 8080
CMD ["node","infra/buffalo-r2/server.mjs"]
