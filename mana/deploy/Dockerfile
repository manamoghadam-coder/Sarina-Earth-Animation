# UNTESTED in the build environment (no Docker available there) — verify with `docker compose build` on your host.
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
# pg_dump 16 (matches postgres:16) for the nightly backup
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg tar \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package*.json server/
RUN cd server && npm ci
COPY server/ server/
COPY --from=web /app/web/dist web/dist
WORKDIR /app/server
EXPOSE 8080
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && exec npx tsx src/index.ts"]
