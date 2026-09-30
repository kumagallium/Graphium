// 拡大・縮小・元に戻すのキーを、キーキャップの並びで見せる部品。
//
// 案内カードと設定の「画面の大きさ」で共有する。押すキー自体が「+」「−」なので、
// Windows / Linux でも 1 キャップに畳まず、OS を問わずキーごとに分ける
// （「Ctrl++」「Ctrl+-」だと、キーをつなぐ「+」と押すキーの「+」が区別できない。design.md の例外）。

import { useT } from "../../i18n";
import { shortcutKeycapsSplit } from "../../lib/shortcut-label";
import { ZOOM_IN_KEYS, ZOOM_OUT_KEYS, ZOOM_RESET_KEYS, zoomKeycapLabel } from "./format";

// span で組む: 設定の要約は <p> の中に入るので、<div> を置くと入れ子が不正になる
function KeyRow({ label, keys, mac }: { label: string; keys: readonly string[]; mac?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-0.5">
        {shortcutKeycapsSplit(keys, mac).map((cap, i) => (
          <kbd
            key={i}
            className="inline-flex min-w-[20px] justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-semibold leading-none text-foreground"
          >
            {zoomKeycapLabel(cap)}
          </kbd>
        ))}
      </span>
    </span>
  );
}

export function ZoomKeys({ mac, className }: { mac?: boolean; className?: string }) {
  const t = useT();
  return (
    <span className={className ?? "flex flex-wrap items-center gap-x-4 gap-y-1.5"}>
      <KeyRow label={t("zoom.keyOut")} keys={ZOOM_OUT_KEYS} mac={mac} />
      <KeyRow label={t("zoom.keyIn")} keys={ZOOM_IN_KEYS} mac={mac} />
      <KeyRow label={t("zoom.keyReset")} keys={ZOOM_RESET_KEYS} mac={mac} />
    </span>
  );
}
