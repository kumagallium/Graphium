// 文脈ラベル（noteContexts）UI のカタログ。
// 議論用途: バッジの見た目・付与ピッカーの挙動（自由入力/サジェスト/新規作成/クリア）・
// ノート一覧「文脈」セルの空状態と複数値表示を Storybook 上で小さく合意する。

import { useMemo, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContextBadge } from "./ContextBadge";
import { ContextTagPicker } from "./ContextTagPicker";
import { aggregateNoteContexts, addNoteContext, removeNoteContext } from "./context-tags";

const meta: Meta = {
  title: "Molecules/NoteContext",
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

// デモ用の擬似ノート集合（実データの雰囲気に寄せる）
const DEMO_NOTES: { title: string; noteContexts: string[] }[] = [
  { title: "TogoMCP 設計メモ", noteContexts: ["eureco", "MCP研究"] },
  { title: "BacteReason 調査", noteContexts: ["MCP研究"] },
  { title: "ProvMind メモ", noteContexts: ["MCP研究", "eureco"] },
  { title: "eureco におけるELNの定義", noteContexts: ["eureco"] },
  { title: "時間の正体は統計的性質", noteContexts: ["哲学"] },
  { title: "エントロピーは増大する", noteContexts: ["哲学"] },
  { title: "ブログ執筆の型", noteContexts: ["ブログ"] },
  { title: "データクオリティとALCOA", noteContexts: [] },
];

// ── バッジ ──────────────────────────────────────────────
export const Badges: Story = {
  name: "バッジ（表示のみ / 削除可）",
  render: () => (
    <div className="p-6 bg-background space-y-4">
      <div>
        <p className="text-xs text-muted-foreground mb-2">表示のみ（一覧セル・ヘッダ用）</p>
        <div className="flex flex-wrap gap-1.5">
          {["eureco", "MCP研究", "哲学", "ブログ", "ELN", "実験ノート"].map((v) => (
            <ContextBadge key={v} value={v} />
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-2">削除可（ヘッダの付与済み表示用）</p>
        <div className="flex flex-wrap gap-1.5">
          {["eureco", "MCP研究"].map((v) => (
            <ContextBadge key={v} value={v} onRemove={() => {}} removeLabel={`${v} を外す`} />
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        色は文脈名のハッシュから安定に決まる（PROV ラベルとは別パレット）。ライト/ダーク両対応。
      </p>
    </div>
  ),
};

// ── 付与ピッカー単体 ────────────────────────────────────
export const Picker: Story = {
  name: "付与ピッカー（自由入力＋サジェスト＋新規作成）",
  render: () => {
    const [open, setOpen] = useState(true);
    const [pos, setPos] = useState({ top: 80, left: 24 });
    const [selected, setSelected] = useState<string[]>(["eureco"]);
    const btnRef = useRef<HTMLButtonElement>(null);
    const suggestions = useMemo(() => aggregateNoteContexts(DEMO_NOTES), []);

    return (
      <div className="p-6 bg-background">
        <p className="text-xs text-muted-foreground mb-3">
          入力すると候補が絞り込まれ、一致が無ければ「＋新規作成」が出る。Enter でも付与。
          チェック済みをクリックで外す。「文脈をクリア」で全解除。
        </p>
        <button
          ref={btnRef}
          type="button"
          onClick={() => {
            if (btnRef.current) {
              const r = btnRef.current.getBoundingClientRect();
              setPos({ top: r.bottom + 4, left: r.left });
            }
            setOpen((v) => !v);
          }}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
        >
          ＋ 文脈
        </button>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {selected.map((v) => (
            <ContextBadge
              key={v}
              value={v}
              onRemove={() => setSelected((s) => removeNoteContext(s, v) ?? [])}
            />
          ))}
        </div>
        {open && (
          <ContextTagPicker
            position={pos}
            onClose={() => setOpen(false)}
            title="文脈"
            selected={selected}
            suggestions={suggestions}
            onAdd={(v) => setSelected((s) => addNoteContext(s, v) ?? [])}
            onRemove={(v) => setSelected((s) => removeNoteContext(s, v) ?? [])}
            onClear={() => setSelected([])}
          />
        )}
        <div className="mt-4 text-xs text-muted-foreground">
          選択中: {selected.length === 0 ? "（なし）" : selected.join(", ")}
        </div>
      </div>
    );
  },
};

// ── ノート一覧「文脈」セル（空状態と複数値、行内付与） ──
export const ListColumnCell: Story = {
  name: "一覧「文脈」セル（空=hoverで＋文脈 / 複数値 / 行内付与）",
  render: () => {
    const [notes, setNotes] = useState(DEMO_NOTES);
    const [openRow, setOpenRow] = useState<number | null>(null);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const suggestions = useMemo(() => aggregateNoteContexts(notes), [notes]);

    const setRowContexts = (i: number, next: string[]) =>
      setNotes((prev) => prev.map((n, idx) => (idx === i ? { ...n, noteContexts: next } : n)));

    return (
      <div className="p-6 bg-background">
        <p className="text-xs text-muted-foreground mb-3">
          未設定行は hover 時だけ破線「＋文脈」。設定済みはピル表示（最大 2 個＋「+N」）。
          セル内クリックは行クリックと衝突しない想定（実装側で stopPropagation）。
        </p>
        <table className="w-full text-sm border border-border rounded">
          <thead>
            <tr className="text-left text-xs font-semibold bg-secondary text-secondary-foreground border-b border-border">
              <th className="py-2 px-3">ノート</th>
              <th className="py-2 px-3 w-[180px]">文脈</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n, i) => {
              const shown = n.noteContexts.slice(0, 2);
              const extra = n.noteContexts.length - shown.length;
              return (
                <tr key={n.title} className="border-b border-border/50 hover:bg-muted/50 group">
                  <td className="py-2 px-3 text-foreground">{n.title}</td>
                  <td className="py-2 px-3">
                    {n.noteContexts.length > 0 ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          setPos({ top: r.bottom + 4, left: r.left });
                          setOpenRow(i);
                        }}
                        className="inline-flex flex-wrap items-center gap-1"
                      >
                        {shown.map((v) => (
                          <ContextBadge key={v} value={v} />
                        ))}
                        {extra > 0 && (
                          <span className="text-[11px] text-muted-foreground">+{extra}</span>
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          setPos({ top: r.bottom + 4, left: r.left });
                          setOpenRow(i);
                        }}
                        className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all"
                      >
                        ＋ 文脈
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {openRow !== null && (
          <ContextTagPicker
            position={pos}
            onClose={() => setOpenRow(null)}
            title="文脈"
            selected={notes[openRow].noteContexts}
            suggestions={suggestions}
            onAdd={(v) => setRowContexts(openRow, addNoteContext(notes[openRow].noteContexts, v) ?? [])}
            onRemove={(v) =>
              setRowContexts(openRow, removeNoteContext(notes[openRow].noteContexts, v) ?? [])
            }
            onClear={() => setRowContexts(openRow, [])}
          />
        )}
      </div>
    );
  },
};

// ── 一括付与（複数選択時の一括バー相当） ─────────────────
export const BulkAssign: Story = {
  name: "一括付与（selected 空で開き追加のみ）",
  render: () => {
    const [open, setOpen] = useState(true);
    const suggestions = useMemo(() => aggregateNoteContexts(DEMO_NOTES), []);
    const [applied, setApplied] = useState<string[]>([]);
    return (
      <div className="p-6 bg-background">
        <p className="text-xs text-muted-foreground mb-3">
          複数選択時の「N件に文脈を付ける」。selected は空で開き、選んだ文脈を全選択行に足す
          （クリアは出さない＝追加専用）。
        </p>
        {open && (
          <ContextTagPicker
            position={{ top: 90, left: 24 }}
            onClose={() => setOpen(false)}
            title="3 件に文脈を付ける"
            selected={applied}
            suggestions={suggestions}
            onAdd={(v) => setApplied((s) => addNoteContext(s, v) ?? [])}
            onRemove={(v) => setApplied((s) => removeNoteContext(s, v) ?? [])}
          />
        )}
        <div className="mt-4 text-xs text-muted-foreground">
          付与予定: {applied.length === 0 ? "（なし）" : applied.join(", ")}
        </div>
      </div>
    );
  },
};
