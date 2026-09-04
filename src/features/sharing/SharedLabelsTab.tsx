// Library「ラベル」タブ — 共有ノートの投影から個人側と同じラベル一覧を描く。
//
// なぜこの形か:
//   個人側は「左ナビのラベル種別 → LabelGalleryView」という 2 段構えになっている。
//   Library には左ナビが無いので、種別の選択をタブ上部のチップに置き換えるだけにして、
//   一覧そのものは LabelGalleryView をそのまま使う（§16 の鏡の原則。別コンポーネントを
//   書くと同じものが 2 つの見た目を持つことになる）。
//
//   集計は FileSidebar のラベルセクションと同じ数え方にそろえる。チップの数字と
//   ギャラリーの行数がずれると「どちらが本当か」が分からなくなるため。
//
// 設計詳細: docs/internal/team-shared-storage-design.md §19

import { useMemo, useState } from "react";
import type { SharedEntry } from "../../lib/storage/shared";
import { getDisplayLabelName, useT } from "../../i18n";
import { LabelGalleryView } from "../asset-browser/LabelGalleryView";
import { buildSharedPseudoIndex, type SharedProjection } from "./shared-projection";

// ラベル色マッピング（NoteListView / FileSidebar / LabelGalleryView と同じ値）。
// LabelGalleryView 側の定数は非公開で、共有タブのためだけに export を足すのは
// 個人側ビューへの変更になるので、ここでは同じ表を持つ。
const LABEL_HEX: Record<string, string> = {
  procedure: "#5b8fb9",
  material: "#4B7A52",
  tool: "#c08b3e",
  attribute: "#c08b3e",
  // Output Entity は v3→v4 で "result" から改名。新キーが無いと色を失う
  output: "#c26356",
  result: "#c26356",
};

export type SharedLabelsTabProps = {
  /** 共有ノートの投影キャッシュ */
  projection: SharedProjection;
  /** 共有ノート（type === "note"）。まだ投影されていないものは自然に除かれる */
  entries: SharedEntry[];
  /** ラベルの行から辿ったノートを開く（共有 id を渡す） */
  onNavigateNote: (sharedId: string) => void;
};

export function SharedLabelsTab({ projection, entries, onNavigateNote }: SharedLabelsTabProps) {
  const uiT = useT();
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);

  // LabelGalleryView に渡す擬似 index。共有 id をノート id として使う
  const noteIndex = useMemo(
    () => buildSharedPseudoIndex(projection, entries),
    [projection, entries],
  );

  // 種別ごとの行数 ＝ ギャラリーで 1 行になる単位（preview / ハイライト文字列 / 工程名）の
  // ユニーク数。FileSidebar の labelCounts と同じ数え方にそろえてある。
  const labelCounts = useMemo(() => {
    const keySets = new Map<string, Set<string>>();
    const ensure = (label: string): Set<string> => {
      let set = keySets.get(label);
      if (!set) {
        set = new Set();
        keySets.set(label, set);
      }
      return set;
    };
    for (const note of noteIndex.notes) {
      for (const l of note.labels) ensure(l.label).add(`block::${l.preview}`);
      for (const il of note.inlineLabels ?? []) ensure(il.label).add(`inline::${il.text}`);
      // step コンテナも「ステップ」ラベルとして数える（個人側と同じ扱い）
      for (const s of note.steps ?? []) ensure("procedure").add(`step::${s.text}`);
    }
    return [...keySets.entries()]
      .map(([label, keys]) => ({ label, count: keys.size }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [noteIndex]);

  // 選んだ種別が投影の更新で消えることがある（共有解除など）。
  // そのときは黙って先頭に戻す（空白のギャラリーを出さない）
  const activeLabel =
    labelCounts.find((c) => c.label === pickedLabel)?.label ?? labelCounts[0]?.label ?? null;

  if (!activeLabel) {
    return (
      <div className="flex-1 overflow-auto px-6 py-10 text-center text-xs text-muted-foreground">
        {uiT("library.empty.labels")}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 種別チップ（個人側の左ナビ「ラベル」セクションに相当する） */}
      <div className="px-6 py-2 border-b border-border flex items-center gap-2 flex-wrap shrink-0">
        {labelCounts.map(({ label, count }) => {
          const color = LABEL_HEX[label] ?? "#8fa394";
          const isActive = label === activeLabel;
          return (
            <button
              key={label}
              onClick={() => setPickedLabel(label)}
              aria-pressed={isActive}
              className="inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-0.5 transition-colors"
              style={{
                backgroundColor: isActive ? color + "18" : "transparent",
                color: isActive ? color : undefined,
                border: `1px solid ${isActive ? color + "38" : "transparent"}`,
                fontWeight: isActive ? 600 : undefined,
              }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className={isActive ? "" : "text-muted-foreground"}>
                {getDisplayLabelName(label)}
              </span>
              <span className="text-[10px] opacity-70 tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {/*
        種別を変えたら検索語・並び替えを持ち越さないよう作り直す（タブ切替と同じ作法）。
        戻る導線はチップが担うので hideBack にする（onBack は呼ばれない）
      */}
      <LabelGalleryView
        key={activeLabel}
        noteIndex={noteIndex}
        label={activeLabel}
        hideBack
        onBack={() => {}}
        onNavigateNote={onNavigateNote}
      />
    </div>
  );
}
