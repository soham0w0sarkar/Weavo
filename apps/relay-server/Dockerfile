FROM oven/bun:1.3.9
WORKDIR /app

COPY apps/relay-server/ ./

ENV PORT=8080
EXPOSE 8080

CMD ["bun", "src/index.ts"]
