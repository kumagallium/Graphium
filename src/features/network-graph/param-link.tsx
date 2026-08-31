// パラメータ・属性値の @参照リンク
//
// 右パネル（プロパティの表）やノードカードの「パラメータを表示」に出る値が
// `@ノート名` / `@素材名` のとき、参照先へ飛べる小さなボタン（↗）を添える。
// - 値そのものはノート側テーブルのただの文字列。ここでは**表示時に**解決するだけで、
//   データには何も足さない（本文セルの @メンションと同じ思想）
// - 解決の実体（ノート名 → noteId、素材名 → 外部ソース ID）はホスト（note-app）が
//   レジストリに登録する。network-graph は noteIndex / mediaIndex を直接知らない
// - 開く経路は onOpenExternalNote（既存）に乗せる。外部ソース ID
//   （pdf:/document:/data:/url:）の振り分けは受け側の Side Peek 実装が行う

import { ExternalLink } from "lucide-react";
import { t } from "../../i18n";

/**
 * 名前 → 開ける ID（ノートの素 ID or 外部ソース ID）。解決できなければ null。
 * note-app が本文メンションのクリック解決と同じロジックを登録する。
 */
let paramLinkResolver: ((name: string) => string | null) | null = null;

export function setParamLinkResolver(resolver: ((name: string) => string | null) | null) {
  paramLinkResolver = resolver;
}

/**
 * セル値・属性値から参照リンク先を解決する。
 * `@名前` 形式（前後の空白は許容）でなければ null。
 */
export function resolveParamLinkTarget(value: string | null | undefined): string | null {
  if (!value || !paramLinkResolver) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("@") || trimmed.length < 2) return null;
  return paramLinkResolver(trimmed.slice(1));
}

/**
 * 参照先へ飛ぶ小さなボタン。解決できた値の隣に置く。
 * （別ノート由来ノードの ↗ と同じ語彙。編集クリックと混ざらないようボタンだけがリンク）
 */
export function ParamLinkButton({
  targetId,
  onOpen,
  size = 10,
}: {
  targetId: string;
  onOpen: (id: string) => void;
  size?: number;
}) {
  return (
    <button
      type="button"
      className="nodrag"
      onClick={(e) => {
        // セルの編集開始・ノード選択にクリックを渡さない
        e.stopPropagation();
        onOpen(targetId);
      }}
      title={t("paramLink.open")}
      aria-label={t("paramLink.open")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 1,
        margin: 0,
        border: "none",
        borderRadius: 3,
        background: "transparent",
        color: "var(--color-primary, var(--color-text-secondary))",
        cursor: "pointer",
        verticalAlign: "middle",
        flexShrink: 0,
      }}
    >
      <ExternalLink size={size} />
    </button>
  );
}
