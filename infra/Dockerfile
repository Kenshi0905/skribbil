# Build from the repository root: docker build -f infra/Dockerfile .
FROM golang:1.25.5-bookworm AS engine-build
WORKDIR /source/engine
COPY engine/go.mod engine/go.sum ./
RUN go mod download
COPY engine/ ./
ENV CGO_ENABLED=0
RUN go build -trimpath -tags timetzdata -ldflags="-s -w" -o /out/skribbil-engine ./cmd/scribblers

FROM node:24-bookworm-slim AS application
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini bash \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/ ./server/
COPY database/ ./database/
COPY scripts/ ./scripts/
COPY web/ ./web/
COPY infra/start.sh ./infra/start.sh
COPY engine/LICENSE ./licenses/scribble-rs-LICENSE
COPY engine/README.md ./licenses/scribble-rs-README.md
COPY engine/UPSTREAM.md ./licenses/scribble-rs-UPSTREAM.md
COPY engine/internal/frontend/resources/draw.js ./engine/internal/frontend/resources/draw.js
COPY --from=engine-build /out/skribbil-engine /usr/local/bin/skribbil-engine
RUN sed -i 's/\r$//' ./infra/start.sh && chmod 0755 ./infra/start.sh \
    && mkdir -p /app/.data/engine-outbox && chown -R node:node /app/.data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 COOKIE_SECURE=true \
    ENGINE_URL=http://127.0.0.1:8080 SKRIBBIL_RANKED_ENABLED=false \
    SKRIBBIL_OUTBOX_DIR=/app/.data/engine-outbox
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--", "/app/infra/start.sh"]
