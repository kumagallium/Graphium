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
// 共有ライブラリ:
//   - 共有ルートに置かれたまま（fork していない）エントリを、題名 / 作者 / 本文で検索
//   - デスクトップ + 共有ルート設定済み + 設定の「AI と検索の対象に含める」が ON のときだけ
//   - 選ぶと Library の該当エントリを開く。エディタが出ていれば引用カードも挿せる
//
// 画像:
//   - fm.mediaIndex に対して、ファイル名 + OCR で読み取った画像内の文字で検索
//   - ノートの下に「画像」セクションとして並べ、選ぶと素材サイドピークが開く
//   - 空入力・`#ラベル` / `@作者` 付きのクエリでは出さない（ノートを探す文脈なので）
//
// AI 質問:
//   - 候補リスト最下段の「AI に質問」アクション行を選んで Enter（または ⌘+Enter）
//   - ノート行を選んで Enter ならジャンプ。ジャンプ用のハンドラがなければ AI に倒れる
//   - `canAskAi=false`（ノートの編集面が出ていないところから開いたとき）は
//     AI 行・発見カード・verb メニュー・grounding チップを畳んで検索専用にする。
//     送信先がその時開いているノートに紐づくため、質問だけは成立しない
//
// compose / insert-prov / insert-media の実装は呼び出し側（note-app.tsx）の
// composerSubmitRef に残しており、将来スラッシュメニューや別ショートカットから再利用できる。

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Bot, Image as ImageIcon, Quote, Search } from "lucide-react";
import { useT } from "@/i18n";
import type { ComposerMode, ComposerSubmission, DiscoveryCard } from "./types";
import { DEFAULT_GROUNDING_SCOPE, type GroundingScope } from "../../lib/grounding-scope";
import { GroundingScopeChip } from "./GroundingScopeChip";
import { WebSearchMissingHint } from "./WebSearchMissingHint";
import { useWebSearchAvailability } from "./use-web-search-availability";
import type { GraphiumIndex } from "../navigation/index-file";
import type { MediaIndex, MediaIndexEntry } from "../asset-browser/media-index";
import { getActiveProvider } from "../../lib/storage/registry";
import {
  searchNotes,
  searchMedia,
  searchShared,
  sharedEntryTitle,
  type SearchHit,
  type MediaHit,
  type SharedHit,
} from "./search";
import { collectLexicalHits } from "./lexical-hits";
import { useLexicalStatus } from "../lexical-search";
// 共有ライブラリは重い SharedLibraryView を巻き込まないよう、バレルではなくストアを直接引く
import { getSharedNoteContexts, useSharedLibrary } from "../sharing/shared-library-store";
import { getSharedRoot, getSharedAiEnabled } from "../../lib/storage/shared/config";
import { isTauri } from "../../lib/platform";
import type { SharedEntry } from "../../lib/storage/shared";
import { CORE_VERBS, AUX_VERBS, buildVerbPrompt, type VerbDef } from "./verbs";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";

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
  /** 素材一覧（素材検索のソース）。ファイル名・OCR テキスト・索引済みテキスト（URL 抜粋 / PDF）で探す */
  mediaIndex?: MediaIndex | null;
  /** 素材行を選んだときのハンドラ。未指定時は素材セクションを出さない */
  onMediaSelect?: (entry: MediaIndexEntry) => void;
  /** 共有エントリ行を選んだときのハンドラ（Library の該当エントリを開く）。
   *  未指定時は共有セクションを出さない */
  onSharedSelect?: (entry: SharedEntry) => void;
  /** 共有エントリの引用カードを今開いているノートに挿すハンドラ。
   *  canInsertCitation が true のときだけ行の右端にボタンを出す */
  onSharedInsertCitation?: (entry: SharedEntry) => void;
  /** エディタの編集面が出ていて引用カードを挿せる状態か（既定 false）。
   *  ⌘K を開いた時点で呼び出し側が判定して渡す（canAskAi と同じ流儀）。 */
  canInsertCitation?: boolean;
  /** 現在開いているノートの引用（knowledge link）数。
   *  J1.5: 入力空のとき 0 → 発見カード（既存）/ 1+ → verb メニューを前面に出す。 */
  citationCount?: number;
  /**
   * AI に質問できる状態か（既定 true）。
   * ノートの編集面が出ていないところから開いたときは false で、
   * AI 行・発見カード・verb メニュー・grounding チップを出さず検索専用にする。
   * 送信先（composerSubmitRef）が開いているノートに紐づくため。
   */
  canAskAi?: boolean;
};

type ResultRow =
  | { kind: "note"; hit: SearchHit }
  | { kind: "shared"; hit: SharedHit }
  | { kind: "media"; hit: MediaHit }
  | { kind: "ask-ai" }
  | { kind: "card"; card: DiscoveryCard };

const MAX_RESULTS = 8;
/** 素材はノートの結果を押しのけない程度に抑える */
const MAX_MEDIA_RESULTS = 4;
/** 共有ライブラリも素材と同じ扱い（手元のノートを押しのけない） */
const MAX_SHARED_RESULTS = 4;

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
    mediaIndex,
    onMediaSelect,
    onSharedSelect,
    onSharedInsertCitation,
    canInsertCitation = false,
    citationCount,
    canAskAi = true,
  } = props;

  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  // IME 確定 Enter 判定（WebKit のイベント順対応。lib/ime-enter.ts 参照）
  const { compositionHandlers, isImeKey } = useImeEnterGuard();
  const [activeIndex, setActiveIndex] = useState(0);
  // grounding スコープ（外部参照/内部参照/ノート内参照）。AI 送信時に何を根拠として渡すかを切り替える。
  const [scope, setScope] = useState<GroundingScope>(DEFAULT_GROUNDING_SCOPE);
  // 外部参照を選んだのに Web 検索手段（サブスクモデル/検索 MCP）が無い構成なら警告を出す。
  // × で閉じたらこのマウント中は再表示しない（構成を直せば条件ごと消える）。
  const webSearch = useWebSearchAvailability(scope === "external");
  const [webSearchHintDismissed, setWebSearchHintDismissed] = useState(false);

  // 語彙インデックス（BM25）の状態。索引が育つ / 作り直されると documents・generation が
  // 変わるので、それを依存に入れて本文ヒットを取り直す（打鍵していなくても結果が追いつく）
  const lexicalStatus = useLexicalStatus();
  const lexicalRevision = `${lexicalStatus.generation}:${lexicalStatus.documents}:${lexicalStatus.state}`;

  // 本文（ノート / ナレッジ）のヒット — noteId → 最良チャンク
  const bodyHits = useMemo(() => {
    if (!noteIndex || !onNoteSelect) return new Map();
    return collectLexicalHits(prompt, ["note", "wiki"]);
    // lexicalRevision は索引の変化を拾うための依存
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, noteIndex, onNoteSelect, lexicalRevision]);

  // 素材テキスト（画像 OCR / URL 抜粋 / PDF）のヒット — fileId → 最良チャンク
  const assetHits = useMemo(() => {
    if (!mediaIndex || !onMediaSelect) return new Map();
    return collectLexicalHits(prompt, ["asset"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, mediaIndex, onMediaSelect, lexicalRevision]);

  // 検索結果（純関数なので useMemo で十分）
  const hits = useMemo(() => {
    if (!noteIndex || !onNoteSelect) return [];
    return searchNotes(prompt, noteIndex.notes, { limit: MAX_RESULTS, bodyHits });
  }, [prompt, noteIndex, onNoteSelect, bodyHits]);

  // 共有ライブラリ — デスクトップ + 共有ルート設定済み + 設定 ON のときだけ出す。
  // localStorage を読むので、開いた瞬間に評価し直す（設定変更が次に開いたときに効く）。
  const sharedEnabled = useMemo(
    () => open && !!onSharedSelect && isTauri() && !!getSharedRoot() && getSharedAiEnabled(),
    [open, onSharedSelect],
  );
  const sharedLibrary = useSharedLibrary();

  // 共有エントリ本文のヒット — 共有エントリ id → 最良チャンク
  const sharedTextHits = useMemo(() => {
    if (!sharedEnabled) return new Map();
    return collectLexicalHits(prompt, ["shared"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, sharedEnabled, lexicalRevision]);

  const sharedHits = useMemo(() => {
    if (!sharedEnabled) return [];
    return searchShared(prompt, sharedLibrary.entries, {
      limit: MAX_SHARED_RESULTS,
      sharedHits: sharedTextHits,
      // 共有時点のフォルダ名でも当てる（手元のノートと同じ理由 "folder"）
      noteContextsOf: (entry) => getSharedNoteContexts(entry, sharedLibrary),
    });
  }, [prompt, sharedEnabled, sharedLibrary, sharedTextHits]);

  // 素材（ファイル名 + OCR で読み取った画像内の文字 + 索引済みテキスト）
  const mediaHits = useMemo(() => {
    if (!mediaIndex || !onMediaSelect) return [];
    return searchMedia(prompt, mediaIndex.media, { limit: MAX_MEDIA_RESULTS, assetHits });
  }, [prompt, mediaIndex, onMediaSelect, assetHits]);

  const trimmed = prompt.trim();
  const isEmptyQuery = trimmed.length === 0;

  const cards = useMemo(() => discoveryCards ?? [], [discoveryCards]);
  // 入力空のときだけ発見カードを出す（検索結果が出ているときは候補が二重になり邪魔）。
  // 検索専用で開いたときはカード自体が AI への導線なので出さない。
  const showCards = isEmptyQuery && cards.length > 0 && canAskAi;

  // J1.5: 引用ブロック（knowledge link）の有無で空入力時の中段を切り替える。
  //   引用 0 → 発見カード（既存維持・破壊性ゼロ）
  //   引用 1+ → verb メニューを前面に出し、発見カードは小さく下に添える
  const hasCitations = (citationCount ?? 0) > 0;
  const showVerbMenu = isEmptyQuery && hasCitations && canAskAi;

  // verb に添える任意コメント（即発火だが補足を一言足せる）
  const [verbComment, setVerbComment] = useState("");

  // 結果行を組み立てる: ノート一覧 + 画像 + 末尾 AI アクション + 発見カード
  // 発見カードもキーボードで選べるように同じ rows 配列にまとめる
  const rows = useMemo<ResultRow[]>(() => {
    const list: ResultRow[] = hits.map((hit) => ({ kind: "note", hit }));
    // 手元のノートの後、素材の前（他人の共有物より自分のノートを先に見せる）
    for (const hit of sharedHits) {
      list.push({ kind: "shared", hit });
    }
    for (const hit of mediaHits) {
      list.push({ kind: "media", hit });
    }
    // 入力が非空のときだけ AI アクションを末尾に出す（空入力は履歴ビューとして純粋に保つ）
    if (!isEmptyQuery && canAskAi) {
      list.push({ kind: "ask-ai" });
    }
    if (showCards) {
      for (const card of cards) {
        list.push({ kind: "card", card });
      }
    }
    return list;
  }, [hits, sharedHits, mediaHits, isEmptyQuery, showCards, cards, canAskAi]);

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
    if (!canAskAi) return;
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
    if (row.kind === "shared") {
      onSharedSelect?.(row.hit.entry);
      return;
    }
    if (row.kind === "media") {
      onMediaSelect?.(row.hit.entry);
      return;
    }
    if (onNoteSelect) {
      onNoteSelect(row.hit.entry.noteId, row.hit.entry.source);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 日本語 IME 変換中は無視。
    // WebKit（Tauri）では確定 Enter が compositionend の後に keydown(13,
    // isComposing=false) として飛ぶため、共通ガード（composition 追跡 +
    // compositionend からの経過時間）で判定する。
    if (isImeKey(e)) return;

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
      aria-label={canAskAi ? t("composer.aria.dialog") : t("composer.aria.dialogSearchOnly")}
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
            {/* 検索専用で開いたときは AI のアイコンを出さない（できないことを示さない） */}
            {canAskAi ? <Bot size={14} /> : <Search size={14} />}
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
            {...compositionHandlers}
            onKeyDown={handleKeyDown}
            placeholder={canAskAi ? t("composer.placeholder") : t("composer.placeholderSearchOnly")}
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
            // 3 セグメント化でチップが縮まないため、狭い幅ではチップを 2 行目に落とす
            //（wrap が無いと左のヒントが数 px 幅まで潰れて縦柱に崩れる）
            flexWrap: "wrap",
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
            ↑↓ {t("composer.search.hintFilters")}
            {canAskAi && <> · ⌘+Enter {t("composer.kbd.submit")}</>} · Esc {t("composer.kbd.close")}
          </span>
          {/* 折返しで 2 行目に落ちたときも右寄せを保つ。
              grounding は AI 送信時に何を根拠にするかの設定なので検索専用では出さない */}
          {canAskAi && (
            <span style={{ marginLeft: "auto" }}>
              <GroundingScopeChip value={scope} onChange={setScope} />
            </span>
          )}
        </div>

        {/* 外部参照選択時、Web 検索手段が無い構成への警告（設定への導線つき・× で閉じられる） */}
        {canAskAi && scope === "external" && webSearch === "missing" && !webSearchHintDismissed && (
          <div style={{ padding: "0 16px 10px" }}>
            <WebSearchMissingHint onDismiss={() => setWebSearchHintDismissed(true)} />
          </div>
        )}

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

            {/* 「共有」セクション — 共有ルートに置かれたままのエントリ（fork 不要で開ける） */}
            {sharedHits.length > 0 && (
              <SectionHeading>{t("composer.search.sharedHeading")}</SectionHeading>
            )}
            {rows.map((row, i) => {
              if (row.kind !== "shared") return null;
              return (
                <SharedRow
                  key={row.hit.entry.id}
                  hit={row.hit}
                  active={i === activeIndex}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => activateRow(row)}
                  onInsertCitation={
                    canInsertCitation && onSharedInsertCitation
                      ? () => onSharedInsertCitation(row.hit.entry)
                      : undefined
                  }
                />
              );
            })}

            {/* 「素材」セクション — ファイル名、OCR で読み取った画像内の文字、URL 抜粋 / PDF 本文で当たる */}
            {mediaHits.length > 0 && (
              <SectionHeading>{t("composer.search.assetsHeading")}</SectionHeading>
            )}
            {rows.map((row, i) => {
              if (row.kind !== "media") return null;
              return (
                <MediaRow
                  key={row.hit.entry.fileId}
                  hit={row.hit}
                  active={i === activeIndex}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => activateRow(row)}
                />
              );
            })}

            {/* 一致 0 件 */}
            {!isEmptyQuery && hits.length === 0 && sharedHits.length === 0 && mediaHits.length === 0 && (
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
            {!isEmptyQuery && canAskAi && (
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

/**
 * 「なぜこの行が出たか」の理由バッジ。今はフォルダ名で当たったときだけ出す
 * （題名にも本文にも見えない場所で当たっているので、印が無いと結果が不気味になる）。
 */
function FolderReasonBadge() {
  const t = useT();
  return (
    <span
      style={{
        fontSize: 10,
        color: "var(--ink-3)",
        flexShrink: 0,
        padding: "1px 5px",
        borderRadius: "var(--r-1)",
        border: "1px solid var(--rule-2)",
      }}
    >
      {t("nav.noteContexts")}
    </span>
  );
}

function NoteRow({ hit, active, onMouseEnter, onClick }: NoteRowProps) {
  const { entry, titleMatches, bodySnippet } = hit;
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
        padding: bodySnippet ? "6px 16px" : "8px 16px",
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
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <span
          style={{
            fontSize: 13,
            lineHeight: 1.4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <HighlightedTitle title={entry.title} ranges={titleMatches} />
        </span>
        {/* 本文（語彙インデックス）で当たった箇所の抜粋 — 素材行の OCR 抜粋と同じ見た目 */}
        {bodySnippet && (
          <span
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <HighlightedTitle title={bodySnippet.text} ranges={bodySnippet.ranges} />
          </span>
        )}
      </span>
      {hit.reasons.includes("folder") && <FolderReasonBadge />}
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

type SharedRowProps = {
  hit: SharedHit;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
  /** 引用カードを挿入する（エディタが出ていないときは undefined＝ボタンを出さない） */
  onInsertCitation?: () => void;
};

/** 行頭アイコン。共有 Library の種別タブと同じ見立て（ノート / ナレッジ / 素材） */
function sharedTypeGlyph(entry: SharedEntry): string {
  if (entry.type === "knowledge") return "📘";
  if (entry.type === "reference") return "🔗";
  if (entry.type === "data-manifest") return "📎";
  return "📄";
}

/**
 * 種別バッジの i18n キー。Library の詳細パネル（SharedLibraryView）と同じ決め方で、
 * note / knowledge はタブ名、素材は media_type ごとの素材種別名を使う。
 */
function sharedTypeLabelKey(entry: SharedEntry): string {
  if (entry.type === "note") return "library.tab.note";
  if (entry.type === "knowledge") return "library.tab.knowledge";
  if (entry.type === "reference") return "asset.type.url";
  const mediaType = (entry.extra as Record<string, unknown> | undefined)?.media_type;
  return `asset.type.${typeof mediaType === "string" ? mediaType : "other"}`;
}

/**
 * 共有エントリ 1 件の行。選ぶと Library の該当エントリが開く（fork はしない）。
 * ノート・素材の行と違い、行そのもののボタンと引用挿入ボタンを横に並べるため、
 * 外枠は div にしてボタンの入れ子を避けている。
 */
function SharedRow({ hit, active, onMouseEnter, onClick, onInsertCitation }: SharedRowProps) {
  const t = useT();
  const { entry, titleMatches, bodySnippet } = hit;
  const title = sharedEntryTitle(entry);
  const authorName = entry.author?.name ?? "";

  return (
    <div
      onMouseEnter={onMouseEnter}
      style={{
        display: "flex",
        alignItems: "center",
        background: active ? "var(--paper-2)" : "transparent",
        borderLeft: active ? "2px solid var(--forest)" : "2px solid transparent",
      }}
    >
      <button
        type="button"
        onClick={onClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          padding: bodySnippet ? "6px 8px 6px 16px" : "8px 8px 8px 16px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          font: "inherit",
          color: "var(--ink)",
        }}
      >
        <span style={{ fontSize: 14, flexShrink: 0 }} aria-hidden>{sharedTypeGlyph(entry)}</span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <span
            style={{
              fontSize: 13,
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <HighlightedTitle title={title || t("library.untitled")} ranges={titleMatches} />
          </span>
          {bodySnippet && (
            <span
              style={{
                fontSize: 11,
                color: "var(--ink-3)",
                lineHeight: 1.4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              <HighlightedTitle title={bodySnippet.text} ranges={bodySnippet.ranges} />
            </span>
          )}
        </span>
        {hit.reasons.includes("folder") && <FolderReasonBadge />}
        {authorName && (
          <span
            style={{
              fontSize: 10,
              color: "var(--ink-3)",
              fontFamily: "var(--mono)",
              flexShrink: 0,
            }}
          >
            @{authorName}
          </span>
        )}
        <span
          style={{
            fontSize: 10,
            color: "var(--ink-3)",
            flexShrink: 0,
            padding: "1px 5px",
            borderRadius: "var(--r-1)",
            border: "1px solid var(--rule-2)",
          }}
        >
          {t(sharedTypeLabelKey(entry))}
        </span>
      </button>
      {onInsertCitation && (
        <button
          type="button"
          onClick={onInsertCitation}
          title={t("composer.shared.insertCitation")}
          aria-label={t("composer.shared.insertCitation")}
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            marginRight: 10,
            background: "transparent",
            border: "1px solid var(--rule-2)",
            borderRadius: "var(--r-1)",
            cursor: "pointer",
            color: "var(--ink-3)",
          }}
        >
          <Quote size={13} aria-hidden />
        </button>
      )}
    </div>
  );
}

type MediaRowProps = {
  hit: MediaHit;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
};

/**
 * 画像 1 件の行。ファイル名の下に、OCR で当たった箇所の抜粋を添える。
 * 選ぶと素材サイドピークが開く（呼び出し側の onMediaSelect）。
 */
function MediaRow({ hit, active, onMouseEnter, onClick }: MediaRowProps) {
  const { entry, nameMatches, ocrSnippet, textSnippet } = hit;
  // 表示する抜粋: 画像は OCR の部分一致を優先、無ければ語彙インデックスの抜粋
  const snippet = ocrSnippet
    ? { text: ocrSnippet.text, ranges: [{ start: ocrSnippet.start, end: ocrSnippet.end }] }
    : textSnippet;

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
        padding: "6px 16px",
        background: active ? "var(--paper-2)" : "transparent",
        border: "none",
        borderLeft: active ? "2px solid var(--forest)" : "2px solid transparent",
        cursor: "pointer",
        font: "inherit",
        color: "var(--ink)",
      }}
    >
      {entry.type === "image" ? <MediaThumb entry={entry} /> : <MediaTypeIcon type={entry.type} />}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <span
          style={{
            fontSize: 13,
            lineHeight: 1.4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <HighlightedTitle title={entry.name} ranges={nameMatches} />
        </span>
        {snippet && (
          <span
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              lineHeight: 1.4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <HighlightedTitle title={snippet.text} ranges={snippet.ranges} />
          </span>
        )}
      </span>
    </button>
  );
}

/** 画像以外の素材の行頭アイコン（サムネイルの代わり・同じ枠サイズ） */
function MediaTypeIcon({ type }: { type: MediaIndexEntry["type"] }) {
  const glyph = type === "pdf" ? "📕" : type === "url" ? "🔗" : type === "document" ? "📝" : "📎";
  return (
    <span
      aria-hidden
      style={{
        width: 32,
        height: 32,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 16,
        borderRadius: "var(--r-1)",
        background: "var(--paper-2)",
      }}
    >
      {glyph}
    </span>
  );
}

/**
 * 行頭のサムネイル。素材の url はプロバイダ内部スキーム（local-media:// 等）のことが
 * あるので、<img src> に入れる前に blob URL へ解決する。
 * 解決の流儀は素材ギャラリーの ImageThumbnail と同じ（外部 URL はそのまま使う）。
 */
function MediaThumb({ entry }: { entry: MediaIndexEntry }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const raw = entry.thumbnailUrl || entry.url;
    if (!raw) return;
    // すでに実体を指している URL はそのまま使う
    if (/^(blob|data):/i.test(raw)) {
      setSrc(raw);
      return;
    }
    let provider: ReturnType<typeof getActiveProvider>;
    try {
      provider = getActiveProvider();
    } catch {
      // プロバイダ未初期化（Storybook 等）— URL をそのまま試す
      setSrc(raw);
      return;
    }
    const fileId = provider.extractFileId(raw);
    if (!fileId) {
      // Google Drive 等: CDN URL をそのまま使う
      setSrc(raw);
      return;
    }
    let cancelled = false;
    provider
      .getMediaBlobUrl(fileId)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        /* 読めなければアイコンのまま */
      });
    return () => {
      cancelled = true;
    };
  }, [entry.thumbnailUrl, entry.url]);

  return (
    <span
      style={{
        width: 32,
        height: 32,
        flexShrink: 0,
        borderRadius: "var(--r-1)",
        overflow: "hidden",
        background: "var(--paper-2)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {src ? (
        // 裸の <img> だと preflight の max-width が効いて潰れるので必ず wrapper 内に置く
        <img
          src={src}
          alt=""
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <ImageIcon size={14} style={{ color: "var(--ink-3)" }} aria-hidden />
      )}
    </span>
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
