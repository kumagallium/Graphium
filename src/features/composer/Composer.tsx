// Cmd+K Composer — 「ノートを探す」「AI に質問する」を 1 つの入力欄に統合した
// Spotlight 風 UI（unified palette）。タブ分割せず、入力に応じて結果が並ぶ。
//
// 検索（Phase 1）:
//   - fm.noteIndex に対するタイトル / 見出し / ラベル / 作者の即時フィルタ
//   - `#xxx` でラベル絞り込み、`@xxx` で作者絞り込み
//   - 入力空のときは直近更新ノート 5 件を「最近のノート」として提示
//   - 一致 0 件のときは AI 質問アクションのみ提示
//   - BM25 / embedding / graph 近傍は別タスク（G-BM25 / G-GRAPHRAG）で hybrid 化
//
// AI 質問:
//   - 候補リスト最下段の「AI に質問」アクション行を選んで Enter（または ⌘+Enter）
//   - ノート行を選んで Enter ならジャンプ。ジャンプ用のハンドラがなければ AI に倒れる
//
// compose / insert-prov / insert-media の実装は呼び出し側（note-app.tsx）の
// composerSubmitRef に残しており、将来スラッシュメニューや別ショートカットから再利用できる。

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Bot } from "lucide-react";
import { useT } from "@/i18n";
import type { ComposerMode, ComposerSubmission, DiscoveryCard } from "./types";
import type { GroundingScope } from "../../lib/grounding-scope";
import { GroundingScopeChip } from "./GroundingScopeChip";
import type { GraphiumIndex } from "../navigation/index-file";
import { searchNotes, type SearchHit } from "./search";
import { CORE_VERBS, AUX_VERBS, buildVerbPrompt, type VerbDef } from "./verbs";

type ComposerProps = {
  open: boolean;
  /** 現状は常に "ask"。将来 UI 復活時のために型は残してある。 */
  mode: ComposerMode;
  prompt: string;
  onPromptChange: (value: string) => void;
  /** 将来用。現在の UI には呼び出す箇所がない。 */
  onModeChange?: (mode: ComposerMode) => void;
  onSubmit: (submission: ComposerSubmission) => void;
  onClose: () => void;
  /** Ask モードの発見カード（直近文脈から呼び出し側が組み立てる） */
  discoveryCards?: DiscoveryCard[];
  onDiscoveryCardSelect?: (card: DiscoveryCard) => void;
  /** ノート一覧（検索ソース） */
  noteIndex?: GraphiumIndex | null;
  /** ノート行を選んだときのジャンプハンドラ。未指定時は検索 UI を出さない */
  onNoteSelect?: (noteId: string, source: "human" | "ai" | "skill" | undefined) => void;
  /** 現在開いているノートの引用（knowledge link）数。
   *  J1.5: 入力空のとき 0 → 発見カード（既存）/ 1+ → verb メニューを前面に出す。 */
  citationCount?: number;
};

type ResultRow =
  | { kind: "note"; hit: SearchHit }
  | { kind: "ask-ai" }
  | { kind: "card"; card: DiscoveryCard };

const MAX_RESULTS = 8;

export function Composer(props: ComposerProps) {
  const {
    open,
    mode,
    prompt,
    onPromptChange,
    onSubmit,
    onClose,
    discoveryCards,
    onDiscoveryCardSelect,
    noteIndex,
    onNoteSelect,
    citationCount,
  } = props;

  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // grounding スコープ（発散/収束）。AI 送信時に引用資料のどの層を渡すかを切り替える。
  const [scope, setScope] = useState<GroundingScope>("overview");

  // 検索結果（純関数なので useMemo で十分）
  const hits = useMemo(() => {
    if (!noteIndex || !onNoteSelect) return [];
    return searchNotes(prompt, noteIndex.notes, { limit: MAX_RESULTS });
  }, [prompt, noteIndex, onNoteSelect]);

  const trimmed = prompt.trim();
  const isEmptyQuery = trimmed.length === 0;

  const cards = useMemo(() => discoveryCards ?? [], [discoveryCards]);
  // 入力空のときだけ発見カードを出す（検索結果が出ているときは候補が二重になり邪魔）
  const showCards = isEmptyQuery && cards.length > 0;

  // J1.5: 引用ブロック（knowledge link）の有無で空入力時の中段を切り替える。
  //   引用 0 → 発見カード（既存維持・破壊性ゼロ）
  //   引用 1+ → verb メニューを前面に出し、発見カードは小さく下に添える
  const hasCitations = (citationCount ?? 0) > 0;
  const showVerbMenu = isEmptyQuery && hasCitations;

  // verb に添える任意コメント（即発火だが補足を一言足せる）
  const [verbComment, setVerbComment] = useState("");

  // 結果行を組み立てる: ノート一覧 + 末尾 AI アクション + 発見カード
  // 発見カードもキーボードで選べるように同じ rows 配列にまとめる
  const rows = useMemo<ResultRow[]>(() => {
    const list: ResultRow[] = hits.map((hit) => ({ kind: "note", hit }));
    // 入力が非空のときだけ AI アクションを末尾に出す（空入力は履歴ビューとして純粋に保つ）
    if (!isEmptyQuery) {
      list.push({ kind: "ask-ai" });
    }
    if (showCards) {
      for (const card of cards) {
        list.push({ kind: "card", card });
      }
    }
    return list;
  }, [hits, isEmptyQuery, showCards, cards]);

  // 入力が変わるたびに先頭にハイライトを戻す（ノート行があればそれ、無ければ AI 行）
  useEffect(() => {
    setActiveIndex(0);
  }, [prompt, open]);

  // 閉じたら verb コメントを破棄（次に開いたときに前回の入力を残さない）
  useEffect(() => {
    if (!open) setVerbComment("");
  }, [open]);

  // 開いた瞬間にフォーカス
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  // Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const submitAi = () => {
    if (trimmed.length === 0) return;
    onSubmit({ mode, prompt: trimmed, scope });
  };

  // verb 押下 → プロンプトテンプレート + 任意コメントを組み立て、既存 Ask 経路に流す。
  // 出力（サイドピーク・提案ブロック・手動取り込み）は後続 PR で差し替える。
  const submitVerb = (def: VerbDef) => {
    const prompt = buildVerbPrompt(
      t(def.promptKey),
      verbComment,
      t("composer.verb.commentLabel"),
    );
    setVerbComment("");
    onSubmit({ mode, prompt, verb: def.id, scope });
  };

  const activateRow = (row: ResultRow) => {
    if (row.kind === "ask-ai") {
      submitAi();
      return;
    }
    if (row.kind === "card") {
      onDiscoveryCardSelect?.(row.card);
      return;
    }
    if (onNoteSelect) {
      onNoteSelect(row.hit.entry.noteId, row.hit.entry.source);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 日本語 IME 変換中は無視。
    // WebKit（Tauri）では IME 確定の Enter で isComposing が false になる場合があるため
    // keyCode === 229 も併せて判定する。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (e.key === "ArrowDown") {
      if (rows.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      if (rows.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      // ⌘+Enter は常に AI 送信（従来動作の保持）
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        submitAi();
        return;
      }
      // 通常 Enter は選択行のアクション。行が無ければ AI 送信フォールバック
      e.preventDefault();
      const row = rows[activeIndex];
      if (row) {
        activateRow(row);
      } else {
        submitAi();
      }
    }
  };

  if (!open) return null;

  const sectionHeading = isEmptyQuery
    ? t("composer.search.recentHeading")
    : t("composer.search.notesHeading");

  return createPortal(
    <div
      role="dialog"
      aria-label={t("composer.aria.dialog")}
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "14vh",
      }}
    >
      {/* オーバーレイ */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "oklch(0.22 0.01 85 / 0.35)",
          backdropFilter: "blur(2px)",
        }}
      />

      {/* 本体 */}
      <div
        style={{
          position: "relative",
          width: "min(640px, calc(100vw - 32px))",
          background: "var(--paper)",
          border: "1px solid var(--rule)",
          borderRadius: "var(--r-3)",
          boxShadow: "var(--shadow-2)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "70vh",
        }}
      >
        {/* 上段 — プロンプト入力（1 行 input。検索 UX では textarea より input が自然） */}
        <div
          style={{
            padding: "14px 16px 10px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: "var(--forest)",
              userSelect: "none",
            }}
            aria-hidden
          >
            <Bot size={14} />
            <span
              style={{
                fontFamily: "ui-monospace, 'SF Mono', monospace",
                fontSize: 13,
              }}
            >
              »
            </span>
          </span>
          <input
            ref={inputRef}
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("composer.placeholder")}
            type="text"
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 15,
              color: "var(--ink)",
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* ショートカット表示 */}
        <div
          style={{
            padding: "0 16px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              fontFamily: "var(--mono)",
            }}
          >
            ↑↓ {t("composer.search.hintFilters")} · ⌘+Enter {t("composer.kbd.submit")} · Esc {t("composer.kbd.close")}
          </span>
          <GroundingScopeChip value={scope} onChange={setScope} />
        </div>

        {/* 結果リスト（onNoteSelect 未配線のときは出さない）
            cards だけの場合（空入力 + カードのみ）は別ブロックで描画するためここはスキップ */}
        {onNoteSelect && (hits.length > 0 || !isEmptyQuery) && (
          <div
            style={{
              borderTop: "1px solid var(--rule-2)",
              overflowY: "auto",
              flex: 1,
            }}
          >
            {/* 「ノート」セクション */}
            {hits.length > 0 && (
              <SectionHeading>{sectionHeading}</SectionHeading>
            )}
            {rows.map((row, i) => {
              if (row.kind === "note") {
                return (
                  <NoteRow
                    key={row.hit.entry.noteId}
                    hit={row.hit}
                    active={i === activeIndex}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => activateRow(row)}
                  />
                );
              }
              // ask-ai 行
              return null;
            })}

            {/* 一致 0 件 */}
            {!isEmptyQuery && hits.length === 0 && (
              <div
                style={{
                  padding: "10px 16px",
                  fontSize: 12,
                  color: "var(--ink-3)",
                }}
              >
                {t("composer.search.empty")}
              </div>
            )}

            {/* 「アクション」セクション (AI に質問) */}
            {!isEmptyQuery && (
              <>
                <SectionHeading>{t("composer.search.actionsHeading")}</SectionHeading>
                {(() => {
                  const askIndex = rows.findIndex((r) => r.kind === "ask-ai");
                  if (askIndex < 0) return null;
                  return (
                    <AskAiRow
                      query={trimmed}
                      label={t("composer.search.askAi", { query: trimmed })}
                      active={askIndex === activeIndex}
                      onMouseEnter={() => setActiveIndex(askIndex)}
                      onClick={submitAi}
                    />
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* verb メニュー（J1.5: 引用 1+ のとき前面に出す）。クリックで即発火 */}
        {showVerbMenu && (
          <VerbMenu
            citationCount={citationCount ?? 0}
            comment={verbComment}
            onCommentChange={setVerbComment}
            onPick={submitVerb}
          />
        )}

        {/* 発見カード — 入力空のときだけ。rows に含まれているのでキーボードで選べる。
            verb メニューが出ているときは補助扱いとして下に小さく添える */}
        {showCards && (
          <div
            style={{
              borderTop: "1px solid var(--rule-2)",
              padding: "8px 12px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 1,
              opacity: showVerbMenu ? 0.7 : 1,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "var(--ink-3)",
                fontFamily: "var(--mono)",
                padding: "2px 4px 4px",
              }}
            >
              {t("composer.discoveryHint")}
            </div>
            {rows.map((row, i) => {
              if (row.kind !== "card") return null;
              const active = i === activeIndex;
              return (
                <button
                  key={row.card.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => activateRow(row)}
                  className="composer-discovery-card"
                  style={{
                    textAlign: "left",
                    padding: "5px 8px",
                    background: active ? "var(--paper-2)" : "transparent",
                    border: "none",
                    borderLeft: active ? "2px solid var(--forest)" : "2px solid transparent",
                    borderRadius: "var(--r-1)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    font: "inherit",
                    width: "100%",
                  }}
                >
                  <span style={{ color: "var(--ink-3)", fontSize: 12, flexShrink: 0 }}>›</span>
                  <span style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
                    {row.card.title}
                  </span>
                  {row.card.hint && (
                    <span style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5 }}>
                      — {row.card.hint}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── 内部コンポーネント ──

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "8px 16px 4px",
        fontSize: 10,
        color: "var(--ink-3)",
        fontFamily: "var(--mono)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </div>
  );
}

type NoteRowProps = {
  hit: SearchHit;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
};

function NoteRow({ hit, active, onMouseEnter, onClick }: NoteRowProps) {
  const { entry, titleMatches } = hit;
  const isWiki = entry.source === "ai";
  const icon = isWiki ? "📘" : entry.model ? "🤖" : "📄";

  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        textAlign: "left",
        padding: "8px 16px",
        background: active ? "var(--paper-2)" : "transparent",
        border: "none",
        borderLeft: active ? "2px solid var(--forest)" : "2px solid transparent",
        cursor: "pointer",
        font: "inherit",
        color: "var(--ink)",
      }}
    >
      <span style={{ fontSize: 14, flexShrink: 0 }} aria-hidden>{icon}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          lineHeight: 1.4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        <HighlightedTitle title={entry.title} ranges={titleMatches} />
      </span>
      {entry.author && (
        <span
          style={{
            fontSize: 10,
            color: "var(--ink-3)",
            fontFamily: "var(--mono)",
            flexShrink: 0,
          }}
        >
          @{entry.author}
        </span>
      )}
    </button>
  );
}

function HighlightedTitle({
  title,
  ranges,
}: {
  title: string;
  ranges: { start: number; end: number }[];
}) {
  if (ranges.length === 0) return <>{title}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (cursor < r.start) parts.push(title.slice(cursor, r.start));
    parts.push(
      <strong key={r.start} style={{ color: "var(--forest)", fontWeight: 600 }}>
        {title.slice(r.start, r.end)}
      </strong>,
    );
    cursor = r.end;
  }
  if (cursor < title.length) parts.push(title.slice(cursor));
  return <>{parts}</>;
}

type AskAiRowProps = {
  query: string;
  label: string;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
};

function AskAiRow({ label, active, onMouseEnter, onClick }: AskAiRowProps) {
  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        textAlign: "left",
        padding: "8px 16px",
        background: active ? "var(--paper-2)" : "transparent",
        border: "none",
        borderLeft: active ? "2px solid var(--forest)" : "2px solid transparent",
        cursor: "pointer",
        font: "inherit",
        color: "var(--ink)",
      }}
    >
      <span style={{ fontSize: 14, flexShrink: 0 }} aria-hidden>✨</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          lineHeight: 1.4,
          color: "var(--ink-2)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 10,
          color: "var(--ink-3)",
          fontFamily: "var(--mono)",
          flexShrink: 0,
        }}
      >
        ↵
      </span>
    </button>
  );
}

// ── verb メニュー（R2） ──
// 引用 1+ のノートで「集合を精査する動詞」を提示する。core 3 + aux 3 の 2 段組 +
// 任意コメント欄。各ボタンは即発火で onPick(def) を呼ぶ。

type VerbMenuProps = {
  citationCount: number;
  comment: string;
  onCommentChange: (value: string) => void;
  onPick: (def: VerbDef) => void;
};

function VerbMenu({ citationCount, comment, onCommentChange, onPick }: VerbMenuProps) {
  const t = useT();
  return (
    <div
      style={{
        borderTop: "1px solid var(--rule-2)",
        padding: "10px 16px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--forest)",
          fontFamily: "var(--mono)",
        }}
      >
        ⚡ {t("composer.verb.title", { count: String(citationCount) })}
      </div>

      {/* core verb（集合精査） */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {CORE_VERBS.map((def) => (
          <VerbButton
            key={def.id}
            label={t(def.labelKey)}
            primary
            onClick={() => onPick(def)}
          />
        ))}
      </div>

      {/* 区切り */}
      <div style={{ height: 1, background: "var(--rule-2)", margin: "1px 0" }} aria-hidden />

      {/* aux verb（発想を広げる） */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {AUX_VERBS.map((def) => (
          <VerbButton key={def.id} label={t(def.labelKey)} onClick={() => onPick(def)} />
        ))}
      </div>

      {/* 任意コメント */}
      <input
        type="text"
        value={comment}
        onChange={(e) => onCommentChange(e.target.value)}
        placeholder={t("composer.verb.commentPlaceholder")}
        autoComplete="off"
        style={{
          marginTop: 2,
          width: "100%",
          border: "1px solid var(--rule-2)",
          borderRadius: "var(--r-1)",
          outline: "none",
          background: "var(--paper-2)",
          padding: "5px 8px",
          fontSize: 12,
          color: "var(--ink)",
          fontFamily: "inherit",
        }}
      />
    </div>
  );
}

type VerbButtonProps = {
  label: string;
  primary?: boolean;
  onClick: () => void;
};

function VerbButton({ label, primary, onClick }: VerbButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="composer-verb-btn"
      style={{
        padding: "5px 10px",
        fontSize: 12.5,
        lineHeight: 1.3,
        cursor: "pointer",
        borderRadius: "var(--r-1)",
        border: `1px solid ${primary ? "var(--forest)" : "var(--rule)"}`,
        background: primary ? "var(--forest)" : "transparent",
        color: primary ? "var(--paper)" : "var(--ink-2)",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}
