// 表の取り込み元バッジの横に出す「元データが変わっています」。
// リンクした素材から取り込んだ表（大きさ・更新日時を覚えているもの）だけが調べる。それ以外は何もしない。

import { useEffect, useState } from "react";
import type { TableSource } from "../../lib/document-types";
import { isTauri } from "../../lib/platform";
import { t, useLocaleSubscription } from "../../i18n";
import { isLinkedSourceChanged, linkedSnapshotOf } from "./linked-import";

export function LinkedSourceChangedNote({ source }: { source: TableSource }) {
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
  return (
    <span
      data-testid="linked-source-changed"
      style={{ fontSize: 10, color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}
    >
      {t("linkedFile.read.sourceChanged")}
    </span>
  );
}
