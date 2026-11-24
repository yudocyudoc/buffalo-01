ARG NODE_BASE_IMAGE
FROM ${NODE_BASE_IMAGE}
ARG BUFFALO_IMAGE_SOURCE_SHA
RUN echo "$BUFFALO_IMAGE_SOURCE_SHA" | grep -Eq '^[a-f0-9]{40}$' \
 && apt-get update -qq && apt-get install -y --no-install-recommends bubblewrap util-linux ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV BUFFALO_IMAGE_SOURCE_SHA=${BUFFALO_IMAGE_SOURCE_SHA} ALLOW_UNSANDBOXED_FALLBACK=false NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY . .
USER node
EXPOSE 8080
CMD ["/usr/bin/setpriv","--inh-caps=-all","--ambient-caps=-all","--no-new-privs","--","node","infra/private-merlin/origin.mjs"]
