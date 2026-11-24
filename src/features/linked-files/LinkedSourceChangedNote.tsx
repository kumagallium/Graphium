// 表の取り込み元バッジの横に出す「元データが変わっています」。
// リンクした素材から取り込んだ表（大きさ・更新日時を覚えているもの）だけが調べる。それ以外は何もしない。

import { useEffect, useState } from "react";
import type { TableSource } from "../../lib/document-types";
import { isTauri } from "../../lib/platform";
import { t, useLocaleSubscription } from "../../i18n";
import { isLinkedSourceChanged, linkedSnapshotOf } from "./linked-import";

export function LinkedSourceChangedNote({
  source,
  layout = "inline",
}: {
  source: TableSource;
  /** inline: 題の行の中（幅が足りなければ省略して縮む）/ line: 題の行の下の 1 行（データ表） */
  layout?: "inline" | "line";
}) {
  useLocaleSubscription();
  const [changed, setChanged] = useState(false);
  const snap = linkedSnapshotOf(source);
  const key = snap ? `${source.derivation?.fromFileId ?? source.fileId}\t${snap.size}\t${snap.mtimeMs}` : "";
  useEffect(() => {
    if (!key || !isTauri()) {
      setChanged(false);
      return;
    }
    let cancelled = false;
    void isLinkedSourceChanged(source)
      .then((c) => {
        if (!cancelled) setChanged(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!changed) return null;
  const text = t("linkedFile.read.sourceChanged");
  // 題を縮めないため、こちらが先に縮む（省略して全文はツールチップ）。line は題の行の下に独立して出す
  const Tag = layout === "line" ? "div" : "span";
  return (
    <Tag
      data-testid="linked-source-changed"
      data-layout={layout}
      data-tooltip={text}
      style={{
        fontSize: layout === "line" ? 11 : 10,
        lineHeight: layout === "line" ? "16px" : undefined,
        color: "var(--color-text-tertiary)",
        padding: layout === "line" ? "0 2px" : undefined,
        minWidth: 0,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {text}
    </Tag>
  );
}
