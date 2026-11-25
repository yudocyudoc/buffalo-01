ARG NODE_BASE=node:22-bookworm-slim
FROM golang:1.24-bookworm AS chains
WORKDIR /src
COPY third-party/causal-chains/ ./
RUN CGO_ENABLED=0 go build -mod=readonly -o /out/causal-chains main.go

FROM ${NODE_BASE}
RUN apt-get update -qq && apt-get install -y --no-install-recommends bubblewrap util-linux ca-certificates python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY . .
RUN python3 -m venv /opt/buffalo-python && /opt/buffalo-python/bin/pip install --no-cache-dir -r third-party/PySD-simulator/requirements.txt
ENV PATH=/opt/buffalo-python/bin:$PATH
COPY --from=chains /out/causal-chains ./third-party/causal-chains/causal-chains
ENV NODE_ENV=production PORT=8080 WEBSOCKET_PORT=8080 ALLOW_UNSANDBOXED_FALLBACK=false
USER node
EXPOSE 8080
CMD ["/usr/bin/setpriv","--inh-caps=-all","--ambient-caps=-all","--no-new-privs","--","node","--import","./infra/full-runtime/bootstrap.mjs","app.js"]
