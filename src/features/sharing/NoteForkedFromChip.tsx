// ノートのヘッダに出す「派生元」チップ（§25b F）。
//
// なぜ必要か:
//   共有ノートを派生（fork）すると `doc.forkedFrom` が付くのに、これまで UI の
//   どこからも読まれていなかった。手元のノートを開いても「これは誰の何から
//   派生したものか」が画面に出ず、提案を出す入口（⋯ メニュー）だけがある状態だった。
//
// 守っていること:
//   - 共有ストアの購読はこの部品の中だけ（NoteSharedCommentsBadge と同じ作法）。
//     ノート本体を共有フォルダの更新で描き直させない
//   - 元の題名は共有ライブラリから引く。まだ読めていない／共有解除されたときは
//     派生したときに控えた作者名にフォールバックする（チップを消さない —— 派生した
//     事実は元が消えても変わらない）

import { GitFork } from "lucide-react";
import { useMemo } from "react";
import { useT } from "../../i18n";
import { cn } from "../../lib/utils";
import type { SharedEntry } from "../../lib/storage/shared";
import { useSharedLibrary } from "./shared-library-store";

export type NoteForkedFrom = {
  sharedId: string;
  hash: string;
  authorName: string;
  authorEmail: string;
  forkedAt: string;
};

function formatDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString();
}

export function NoteForkedFromChip({
  forkedFrom,
  onOpen,
  entries,
}: {
  forkedFrom: NoteForkedFrom;
  /** 押すと元の共有エントリを全画面で開く（openSharedEntryFull）。無ければ押せない */
  onOpen?: (sharedId: string) => void;
  /** DI: 共有エントリ一覧（既定は共有ストア）。Storybook / テスト用 */
  entries?: readonly SharedEntry[];
}) {
  const t = useT();
  const shared = useSharedLibrary();
  const source = entries ?? shared.entries;
  const title = useMemo(() => {
    const entry = source.find((e) => e.id === forkedFrom.sharedId && e.type !== "proposal");
    const value = (entry?.extra as { title?: unknown } | undefined)?.title;
    return typeof value === "string" && value ? value : "";
  }, [source, forkedFrom.sharedId]);

  const label = title || forkedFrom.authorName || forkedFrom.sharedId;
  const date = formatDate(forkedFrom.forkedAt);

  return (
    <button
      type="button"
      onClick={onOpen ? () => onOpen(forkedFrom.sharedId) : undefined}
      data-testid="note-forked-from"
      title={t("fork.chipHint", {
        title: title || forkedFrom.sharedId,
        author: forkedFrom.authorName || "",
        date,
      })}
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded-md shrink-0 inline-flex items-center gap-1 max-w-[220px] transition-colors",
        "bg-muted text-muted-foreground",
        onOpen ? "cursor-pointer hover:text-foreground" : "cursor-default",
      )}
    >
      <GitFork size={10} className="shrink-0" />
      <span className="truncate">{t("fork.chip", { title: label })}</span>
    </button>
  );
}
