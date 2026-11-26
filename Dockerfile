FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM oven/bun:1 AS production-deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    PYTHON_EXECUTABLE=python3

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server.ts ./
COPY server/aiProviders.ts server/analyze_media.py ./server/
COPY src ./src

EXPOSE 3000
USER node
CMD ["node", "server.ts"]
