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

# ビルドの最初に走る scripts/fetch-fonts.mjs が curl で日本語フォントを取りに行く（alpine には入っていない）
RUN apk add --no-cache curl

WORKDIR /app

# pnpm-workspace.yaml（patchedDependencies など pnpm の設定）と patches/ も先に入れる。
# 無いと lockfile の patchedDependencies と設定が食い違い、frozen install が落ちる
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .

# フロントエンドをビルド + サーバーを単一 ESM ファイルにバンドル。
# Node の既定のヒープ上限（メモリ 16GB 未満の環境では約 2GB）では vite build が足りずに落ちるので、
# リリースのワークフロー（tauri-build.yml）と同じ 4GB にする
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm build && node scripts/bundle-server.mjs

# ── Stage 2: Runtime ──
# サーバーは esbuild でバンドル済み（src-tauri/sidecar/server.mjs）なので
# ランタイムは Node のみで足り、依存パッケージ・パッケージマネージャ不要。
FROM node:22-alpine

WORKDIR /app

# バンドル済みサーバー
COPY --from=builder /app/src-tauri/sidecar/server.mjs server.mjs

# フロントエンドビルド成果物
COPY --from=builder /app/dist dist/

# su-exec: 入口のスクリプトが root で所有者を直したあと、node ユーザーに落として起動する
RUN apk add --no-cache su-exec

# データディレクトリ
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data

# 入口: root 以外で動かす（既存ボリューム・bind mount の所有者の扱いはスクリプト内に記載）
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data
# コンテナ内では全インターフェースで待ち受ける（サーバーの既定は 127.0.0.1。
# 外部への公開範囲は compose / docker run の ports 設定で制御する）
ENV GRAPHIUM_BIND_HOST=0.0.0.0
# 起動時の警告をコンテナ向けの案内に切り替える目印
ENV GRAPHIUM_CONTAINER=1
# フロントエンド配信はバックエンドではなく nginx で行う場合はこの行を削除
ENV SERVE_STATIC=dist

EXPOSE 3001

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.mjs"]
