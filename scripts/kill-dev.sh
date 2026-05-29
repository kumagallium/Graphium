#!/bin/bash
# dev サーバー起動前の準備スクリプト（predev で自動実行）
#
# 1. 既存の dev サーバーを停止（デスクトップ sidecar は保護）
# 2. dev 用ポートは常に 3002（3001 はデスクトップ sidecar 専用に予約）
# 3. data/models.json を本体 worktree と共有（シンボリックリンク）
#
# ポート割当ポリシー:
#   - 3001 = デスクトップアプリ sidecar 専用（dev は決して使わない）
#   - 3002 = dev 環境の sidecar 固定
#   理由: dev sidecar が 3001 を奪うと、後でデスクトップアプリが起動しても
#         自前 sidecar をバインドできず、worktree 側の dev sidecar と
#         無自覚に通信してしまう（モデル設定が見えない等の事故が出る）。

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEV_PORT_FILE="$PROJECT_DIR/.dev-port"
DEV_PORT=3002

# sidecar のプロセスかどうか判定（バンドル済み server.mjs を実行中）
is_sidecar() {
  local cmd="$1"
  # sidecar は server.mjs を実行する（dev は src/server/index.ts を使う）
  echo "$cmd" | grep -q "server\.mjs" && return 0
  # Graphium.app の子プロセスも除外
  echo "$cmd" | grep -q "Graphium.app" && return 0
  return 1
}

# ── 1. 既存 dev サーバーの停止 ──
# - 5174 / $DEV_PORT / 3001 を掃除
# - デスクトップ sidecar (server.mjs) は常に保護
# - 3001 上の tsx 等の dev プロセスは「ゾンビ」として殺す
#   （以前のバグで dev が 3001 を奪った場合の回収処理）
killed=0

for port in 5174 "$DEV_PORT" 3001; do
  pids=$(lsof -i :"$port" -t 2>/dev/null)
  for pid in $pids; do
    cmd=$(ps -p "$pid" -o command= 2>/dev/null)
    if is_sidecar "$cmd"; then
      [ "$port" = "3001" ] && echo "[kill-dev] Desktop sidecar on port 3001 (PID $pid) — protected"
      continue
    fi
    if echo "$cmd" | grep -q "node"; then
      if kill "$pid" 2>/dev/null; then
        echo "[kill-dev] Stopped PID $pid (port $port)"
        killed=$((killed + 1))
      fi
    fi
  done
done

if [ "$killed" -eq 0 ]; then
  echo "[kill-dev] No existing dev servers found"
fi

# ── 2. dev 用ポートを固定 ──
echo "$DEV_PORT" > "$DEV_PORT_FILE"
echo "[kill-dev] Dev server will use port $DEV_PORT (3001 reserved for desktop sidecar)"

# ── 3. data/models.json の共有 ──
# worktree の場合、本体の data/models.json をシンボリックリンクで共有する
# これにより AI モデル登録を全 worktree で共有できる

DATA_DIR="$PROJECT_DIR/data"
MODELS_FILE="$DATA_DIR/models.json"

# worktree かどうか判定（.git がファイルなら worktree）
if [ -f "$PROJECT_DIR/.git" ]; then
  GITDIR=$(sed 's/^gitdir: //' "$PROJECT_DIR/.git")
  if echo "$GITDIR" | grep -q "/worktrees/"; then
    MODULE_GIT_DIR=$(echo "$GITDIR" | sed 's|/worktrees/.*||')
    if [ -f "$MODULE_GIT_DIR/commondir" ]; then
      MODULE_GIT_DIR="$(cd "$MODULE_GIT_DIR" && cd "$(cat commondir)" && pwd)"
    fi
    MAIN_WORKTREE=$(git --git-dir="$MODULE_GIT_DIR" config core.worktree 2>/dev/null)
    if [ -n "$MAIN_WORKTREE" ] && [ "${MAIN_WORKTREE:0:1}" != "/" ]; then
      MAIN_WORKTREE="$(cd "$MODULE_GIT_DIR" && cd "$MAIN_WORKTREE" && pwd)"
    fi
    if [ -z "$MAIN_WORKTREE" ]; then
      MAIN_WORKTREE=$(git -C "$PROJECT_DIR" worktree list 2>/dev/null | head -1 | awk '{print $1}')
      if echo "$MAIN_WORKTREE" | grep -q "/.git/"; then
        PARENT_REPO=$(echo "$MAIN_WORKTREE" | sed 's|/\.git/modules/.*||')
        MODULE_NAME=$(echo "$MAIN_WORKTREE" | sed 's|.*/\.git/modules/||')
        MAIN_WORKTREE="$PARENT_REPO/$MODULE_NAME"
      fi
    fi

    if [ -n "$MAIN_WORKTREE" ] && [ -d "$MAIN_WORKTREE/data" ]; then
      # worktree の data/ 自体が親 worktree への symlink の場合、models.json は
      # 既に親と共有済み。ここで symlink を張ろうとすると data symlink を二重に
      # 辿り、親の data/models.json を自己参照 symlink に化けさせてしまう
      # （ELOOP で vite が落ちる過去の不具合）。共有済みなので何もしない。
      if [ -L "$DATA_DIR" ]; then
        echo "[kill-dev] data/ is a symlink to the main worktree — models.json already shared"
      else
        MAIN_MODELS="$MAIN_WORKTREE/data/models.json"
        # 自己参照ループを防ぐ（data symlink を辿った実体パスで比較する）
        MAIN_MODELS_REAL=$(cd "$MAIN_WORKTREE/data" 2>/dev/null && pwd -P)/models.json
        MODELS_FILE_REAL=$(cd "$DATA_DIR" 2>/dev/null && pwd -P)/models.json
        if [ "$MAIN_MODELS_REAL" = "$MODELS_FILE_REAL" ]; then
          echo "[kill-dev] models.json link skipped (would self-reference)"
        elif [ -f "$MAIN_MODELS" ] && [ ! -L "$MODELS_FILE" ]; then
          mkdir -p "$DATA_DIR"
          if [ -f "$MODELS_FILE" ]; then
            mv "$MODELS_FILE" "$MODELS_FILE.bak"
            echo "[kill-dev] Backed up existing models.json"
          fi
          ln -s "$MAIN_MODELS" "$MODELS_FILE"
          echo "[kill-dev] Linked models.json → $MAIN_MODELS"
        elif [ -L "$MODELS_FILE" ]; then
          # 既存シンボリックリンクが自己参照になっていたら修復
          LINK_TARGET=$(readlink "$MODELS_FILE")
          case "$LINK_TARGET" in
            /*) LINK_ABS="$LINK_TARGET" ;;
            *)  LINK_ABS="$DATA_DIR/$LINK_TARGET" ;;
          esac
          LINK_REAL=$(cd "$(dirname "$LINK_ABS")" 2>/dev/null && pwd -P)/$(basename "$LINK_ABS")
          if [ "$LINK_REAL" = "$MODELS_FILE_REAL" ]; then
            echo "[kill-dev] Removed self-referential models.json symlink"
            rm "$MODELS_FILE"
            if [ -f "$MAIN_MODELS" ]; then
              ln -s "$MAIN_MODELS" "$MODELS_FILE"
              echo "[kill-dev] Re-linked models.json → $MAIN_MODELS"
            fi
          else
            echo "[kill-dev] models.json already linked"
          fi
        fi
      fi
    fi
  fi
fi
