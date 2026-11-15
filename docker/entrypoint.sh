#!/bin/sh
# Graphium コンテナの入口。root で起動しても、サーバーは root 以外で動かす。
# 以前の版は root で動いていたため、既存ボリュームの中身は root 所有になっている。
# 単に USER node にすると、更新した利用者のサーバーがデータを読み書きできず起動しない。
#
# 方針: 迷ったら「今までどおり root で起動」に倒す（起動しなくなるより安全）。
#   1. root 以外で起動された（compose の user: / --user）    → そのまま
#   2. GRAPHIUM_RUN_AS_ROOT=1                                   → root のまま（逃げ道）
#   3. rootless（コンテナの root がホストの一般ユーザー）       → そのまま
#   4. データの持ち主が root 以外（bind mount・直したあと）     → その uid:gid で動かす
#   5. 持ち主は root に見えるが node がそのまま書ける        → 何も直さず node で動かす（Docker Desktop の bind mount）
#   6. 持ち主が root（以前の版が書いた名前付きボリューム）     → 持ち主を node に直してから node で動かす
set -eu

DATA_DIR="${DATA_DIR:-/app/data}"

# 1. 最初から root 以外で起動された（compose の user: / --user）なら何もしない
if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

# 2. 逃げ道: 今までどおり root のまま動かす
if [ "${GRAPHIUM_RUN_AS_ROOT:-}" = "1" ]; then
  echo "graphium: WARNING: GRAPHIUM_RUN_AS_ROOT=1 のため root で動かします（サーバーに弱点があるとコンテナ内の root を取られます）" >&2
  exec "$@"
fi

# 3. rootless Docker / Podman・userns-remap: コンテナの root はホストでは一般ユーザー。
#    ここで node に落とすと、ホスト側ではフォルダの持ち主と別の uid になり、
#    利用者が自分のフォルダを触れなくなる。既にホストの root ではないので、そのまま動かす
uid_map="${GRAPHIUM_UID_MAP_FILE:-/proc/self/uid_map}"
if [ -r "$uid_map" ]; then
  host_uid="0"
  read -r _inside host_uid _count < "$uid_map" || true
  if [ "${host_uid:-0}" != "0" ]; then
    exec "$@"
  fi
fi

# データディレクトリが無ければ作る
if [ ! -d "$DATA_DIR" ]; then
  if ! { mkdir -p "$DATA_DIR" && chmod 700 "$DATA_DIR"; }; then
    echo "graphium: WARNING: $DATA_DIR を作れません。root のまま起動します" >&2
    exec "$@"
  fi
fi

node_uid="$(id -u node)"
owner="$(stat -c '%u:%g' "$DATA_DIR")"
uid="${owner%%:*}"

# 4. 持ち主が root 以外: その uid:gid で動かす（ホストのフォルダの持ち主を書き換えない）。
#    名前付きボリュームを直したあとの 2 回目以降もここを通る（持ち主は node）
if [ "$uid" != "0" ]; then
  # 以前の版（root）が作ったファイルが残っていると、その分は書けない。浅い所だけ見て警告する
  # （以前の版はフォルダごと root で作るので、上の 2 段を見れば分かる。全体は歩かない）。
  # 動かす uid から見た持ち主で調べる（Docker Desktop の共有は、見る側によって持ち主が変わる）
  rootowned="$(su-exec "$owner" find "$DATA_DIR" -maxdepth 2 -user 0 2>/dev/null | head -n 1 || true)"
  if [ -n "$rootowned" ]; then
    echo "graphium: WARNING: $DATA_DIR の中に root 所有のファイルがあります（例: $rootowned）。$owner からは書けません。ホスト側で chown -R $owner <フォルダ> してください" >&2
  fi
  if [ "$uid" = "$node_uid" ]; then
    exec su-exec node:node "$@"
  fi
  # passwd に無い uid は、su-exec が HOME を / にする。書ける場所を指しておく
  exec su-exec "$owner" env HOME=/tmp "$@"
fi

# 5. 持ち主は root に見えるが、node がそのまま書ける: 持ち主を実際には区別しない共有
#    （Docker Desktop の bind mount）。直す必要が無いので、何も書き換えずに node で動かす。
#    上の 2 段を全部書けるかで見る（リンクは先を見に行かない）
if su-exec node:node sh -c 'find "$1" -maxdepth 2 | while IFS= read -r p; do [ -L "$p" ] || [ -w "$p" ] || exit 1; done' sh "$DATA_DIR" 2>/dev/null; then
  exec su-exec node:node "$@"
fi

# 6. 以前の版が root で書いたデータ（新しい名前付きボリュームはイメージ側の node 所有で作られるので、ここには来ない）
echo "graphium: $DATA_DIR の所有者を node に直します（以前の版は root で書いていたため。1 度だけ）" >&2
# 子を先・DATA_DIR 自身を最後に直す（-depth）。途中で止まっても DATA_DIR が root のままなので次回も続きから直る。
# -h はリンク先でなくリンク自身を直すため（ボリューム外を触らない）
if find "$DATA_DIR" -depth -exec chown -h node:node {} +; then
  exec su-exec node:node "$@"
fi
echo "graphium: WARNING: $DATA_DIR の所有者を直せませんでした（読み取り専用・NFS・同期フォルダなど）。以前と同じく root で起動します" >&2
exec "$@"
