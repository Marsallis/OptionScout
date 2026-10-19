FROM node:22-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app

COPY --from=build /app /app
RUN npm prune --omit=dev

ENV NODE_ENV=production \
    RUNNING_IN_DOCKER=true \
    BIND_HOST=0.0.0.0 \
    PORT=3180 \
    DATABASE_PATH=/data/optionscout.sqlite \
    DATA_MODE=demo \
    AUTH_MODE=local-owner \
    ENABLE_ORDER_EXECUTION=false \
    TELEMETRY_ENABLED=false \
    STATIC_DIR=/app/apps/web/dist

RUN mkdir -p /data

VOLUME /data
EXPOSE 3180

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:3180/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
