FROM oven/bun:1

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src

USER bun
CMD ["bun", "src/index.ts"]
