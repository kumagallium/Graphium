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

# フロントエンドをビルド + サーバーを単一 ESM ファイルにバンドル
RUN pnpm build && node scripts/bundle-server.mjs

# ── Stage 2: Runtime ──
# サーバーは esbuild でバンドル済み（src-tauri/sidecar/server.mjs）なので
# ランタイムは Node のみで足り、依存パッケージ・パッケージマネージャ不要。
FROM node:20-alpine

WORKDIR /app

# バンドル済みサーバー
COPY --from=builder /app/src-tauri/sidecar/server.mjs server.mjs

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

CMD ["node", "server.mjs"]
