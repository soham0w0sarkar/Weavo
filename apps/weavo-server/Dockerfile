FROM oven/bun:1.3.9

WORKDIR /app

COPY apps/weavo-server/package.json ./
COPY apps/weavo-server/src ./src

ENV PORT=8080
EXPOSE 8080

CMD ["bun", "src/index.ts"]
