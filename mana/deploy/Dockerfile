# UNTESTED in the build environment (no Docker available there) — verify with `docker compose build` on your host.
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY server/package*.json server/
RUN cd server && npm ci
COPY server/ server/
COPY --from=web /app/web/dist web/dist
WORKDIR /app/server
EXPOSE 8080
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && exec npx tsx src/index.ts"]
