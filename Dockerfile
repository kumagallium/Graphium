# Graphium — multi-stage build (frontend + backend)
#
# Stage 1: Build frontend with Vite
# Stage 2: Run Node.js backend (serves frontend static files + API)

# Node のメジャーはデスクトップ版の sidecar（scripts/fetch-node.mjs の NODE_VERSION）と揃える。
# security-check.yml がサポート終了の接近を見張っている。

# ── Stage 1: Build ──
FROM node:22-alpine AS builder

# pnpm は CI と同じ 10 系に固定する（latest だとメジャーが変わった日に
# lockfile とパッチのハッシュが合わなくなり frozen install が落ちる）
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# フロントエンドをビルド + サーバーを単一 ESM ファイルにバンドル
RUN pnpm build && node scripts/bundle-server.mjs

# ── Stage 2: Runtime ──
# サーバーは esbuild でバンドル済み（src-tauri/sidecar/server.mjs）なので
# ランタイムは Node のみで足り、依存パッケージ・パッケージマネージャ不要。
FROM node:22-alpine

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
# コンテナ内では全インターフェースで待ち受ける（サーバーの既定は 127.0.0.1。
# 外部への公開範囲は compose / docker run の ports 設定で制御する）
ENV GRAPHIUM_BIND_HOST=0.0.0.0
# フロントエンド配信はバックエンドではなく nginx で行う場合はこの行を削除
ENV SERVE_STATIC=dist

EXPOSE 3001

CMD ["node", "server.mjs"]
