# ERP — تصویر تولیدی (Node 22؛ SQLite داخلی Node + درایور اختیاری pg)
FROM node:22-bookworm-slim

# tar و pg_dump/pg_restore برای پشتیبان‌گیری؛ tini برای مدیریت درست سیگنال‌ها
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini tar gzip postgresql-client ca-certificates \
 && apt-get clean

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY public ./public

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    ERP_DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
