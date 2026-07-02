FROM oven/bun:1.3.9

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["bun", "src/index.ts"]