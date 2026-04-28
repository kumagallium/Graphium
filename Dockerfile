# Graphium — multi-stage build (frontend + backend)
#
# Stage 1: Build frontend with Vite
# Stage 2: Run Node.js backend (serves frontend static files + API)

# ── Stage 1: Build ──
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

# ── Stage 2: Runtime ──
FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# 本番依存のみインストール
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# バックエンドソース（tsx で実行）
COPY src/server/ src/server/

# フロントエンドビルド成果物
COPY --from=builder /app/dist dist/

# データディレクトリ
RUN mkdir -p /app/data
VOLUME /app/data

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data
# フロントエンド配信はバックエンドではなく nginx で行う場合はこの行を削除
ENV SERVE_STATIC=dist

EXPOSE 3001

# tsx でバックエンドを起動
CMD ["npx", "tsx", "src/server/index.ts"]
