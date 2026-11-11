FROM oven/bun:1.3.9

WORKDIR /app

COPY package.json bun.lock turbo.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=weavo-server...

ENV PORT=8080
EXPOSE 8080

WORKDIR /app/apps/weavo-server
CMD ["bun", "src/index.ts"]
