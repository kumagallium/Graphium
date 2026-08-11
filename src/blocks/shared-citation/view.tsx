// shared:// 引用ブロック（Phase 2c-2）。
//
// ノート本文中に共有エントリへの参照カードを置く。ノートに保存されるのは
// 「共有 ID + 引用時の hash + 表示用スナップショット」だけで、本体は shared 側にある。
// スナップショットが props に入っているため、共有ストレージに到達できなくても
// カードは描ける（offline 表示 = 災害耐性）。
//
// minor 追従: 表示時に共有側が正規更新されていたら（entry.hash が引用時と違う）、
// スナップショットと citedHash を黙って最新へ更新する（設計 §9: minor は通知しない）。
// major 改訂（superseded_by）は新版バナーで知らせ、勝手に差し替えない。

import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useState } from "react";
import {
  SharedCitationCard,
  type CitationStatus,
} from "../../features/sharing/SharedCitationCard";
import type { SharedEntryType } from "../../lib/storage/shared";
import { resolveCitation, type CitationResolution } from "./resolve";
import { entryToCachedProps } from "./props";
import { hasSharedEntryOpenCallback, openSharedEntry } from "./callbacks";
import { t } from "../../i18n";

function SharedCitationView({ block, editor }: { block: any; editor: any }) {
  const {
    sharedId,
    citedHash,
    entryType,
    cachedTitle,
    cachedAuthor,
    cachedUpdatedAt,
    citedVersion,
    fileName,
    fileSizeLabel,
  } = block.props;

  const [resolution, setResolution] = useState<CitationResolution | null>(null);

  // sharedId 単位で 1 回だけ解決する。minor 追従の updateBlock で citedHash が
  // 変わっても再解決しない（追従 → 再解決 → 追従のループ防止）。
  useEffect(() => {
    if (!sharedId) return;
    let cancelled = false;
    resolveCitation(sharedId).then((r) => {
      if (cancelled) return;
      setResolution(r);
      if (
        r.status === "verified" &&
        r.entry &&
        r.entry.hash !== block.props.citedHash &&
        editor?.isEditable
      ) {
        // minor 追従: スナップショットを最新化して永続化
        editor.updateBlock(block, {
          props: { ...entryToCachedProps(r.entry), citedHash: r.entry.hash },
        });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedId]);

  const status: CitationStatus = sharedId
    ? (resolution?.status ?? "checking")
    : "missing";
  const supersededBy = resolution?.entry?.superseded_by;

  return (
    <div className="w-full" data-shared-citation-id={sharedId}>
      <SharedCitationCard
        title={cachedTitle || t("citation.untitled")}
        entryType={(entryType || "note") as SharedEntryType}
        authorName={cachedAuthor}
        updatedAt={cachedUpdatedAt}
        status={status}
        version={citedVersion > 1 ? citedVersion : undefined}
        hasNewerVersion={resolution?.hasNewerVersion}
        fileInfo={fileName ? { name: fileName, sizeLabel: fileSizeLabel || undefined } : undefined}
        onOpen={
          hasSharedEntryOpenCallback() && sharedId
            ? () => openSharedEntry(sharedId)
            : undefined
        }
        onOpenLatest={
          hasSharedEntryOpenCallback() && supersededBy
            ? () => openSharedEntry(supersededBy)
            : undefined
        }
      />
    </div>
  );
}

export const SharedCitationBlockSpec = createReactBlockSpec(
  {
    type: "sharedCitation" as const,
    propSchema: {
      // 参照の本体: 共有エントリ ID（uuidv7）
      sharedId: { default: "" },
      // 引用時（または最後に追従した時点）の SharedEntry.hash
      citedHash: { default: "" },
      // SharedEntryType（note / reference / data-manifest / ...）
      entryType: { default: "note" },
      // 最初に引用した日時（ISO）。minor 追従でも変えない
      citedAt: { default: "" },
      // ── 表示用スナップショット（offline でもカードを描くための複製） ──
      cachedTitle: { default: "" },
      cachedAuthor: { default: "" },
      cachedUpdatedAt: { default: "" },
      citedVersion: { default: 1 },
      fileName: { default: "" },
      fileSizeLabel: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: (props) => (
      <SharedCitationView block={props.block} editor={props.editor} />
    ),
  },
);
