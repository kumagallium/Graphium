// テーブルのキャプション（名前）レイヤー
//
// IndexTableIconLayer と同じパターンで body ポータルに描画する。
// 学術文書の慣例どおりテーブルのキャプションは表の上に置く。名前は tableMeta.caption
// に保存され、チャートブロックが参照テーブルの表示名として使う（eureco の
// 「データテーブル1: 地点Aの観測結果」に相当する、参照に耐える名前）。
//
// 描画対象は「名前が付いているテーブル」と「日時が自動で入るテーブル（無名でも
// 表 N を出す）」。名前の無いふつうのテーブルには何も出さない — 付ける入口は
// ⠿ メニューの「テーブルに名前を付ける」で、そこから編集要求が来たときだけ
// 入力欄を出す。

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t, useLocaleSubscription } from "../../i18n";
import { computeTableDisplayNames } from "./auto-name";
import { useTableMetaStore } from "./store";
import type { TableSource } from "./types";

type CaptionPos = {
  blockId: string;
  top: number;
  left: number;
  width: number;
  /** 表示名（無名の記録テーブルなら「表 N」の自動名） */
  displayName: string;
  /** ヘッダを除いたデータ行数（折りたたみ判定に使う） */
  rowCount: number;
  /** 表の下端（画面座標）。折りたたみ中の「続きがある」表示をここに重ねる */
  bottom: number;
  /** 折りたたみ中に隠れている行数の目安（0 なら隠れていない） */
  hiddenRows: number;
};

/**
 * これを超える行数の取り込みテーブルは既定で高さを抑える。
 * 装置ログは数百行が普通で、そのまま展開すると本文がデータで埋まり、
 * ノートとしての読み筋が消えてしまう。
 */
const COLLAPSE_ROW_THRESHOLD = 20;
/** 折りたたみ時の表示高さ（px）。ヘッダ + 数行が見える程度 */
const COLLAPSED_MAX_HEIGHT = 320;
/** 裾のフェードの高さ（px）。この中に「あと N 行」ボタンを浮かせる */
const FADE_HEIGHT = 64;

/** 取り込み元バッジのツールチップ。行範囲・測定条件・クリック時の動作を並べる */
function sourceTooltip(source: TableSource, clickable: boolean): string {
  const head = t("dataImport.sourceTooltip", {
    fileName: source.fileName,
    headerRow: String(source.options.headerRow),
    endRow: String(source.options.endRow),
  });
  const meta = (source.meta ?? []).map((m) => `${m.key}: ${m.value}`);
  const hint = clickable ? [t("dataImport.sourceClickHint")] : [];
  return [head, ...meta, ...hint].join("\n");
}

export function TableCaptionLayer({
  editorRef,
  onReimport,
}: {
  editorRef: React.RefObject<any>;
  /**
   * 取り込み由来のテーブルで「取り込み元」バッジを押したときのハンドラ。
   * 素材として残っている元ファイルを読み直し、保存済みの設定でダイアログを開く。
   * 渡されない場合はバッジは表示だけ（ツールチップで出所を示す）になる。
   */
  onReimport?: (blockId: string, source: TableSource) => void;
}) {
  // 言語切替でラベルを引き直す（モジュールスコープの t() は自前で購読しないと古いまま）
  useLocaleSubscription();
  const store = useTableMetaStore();
  const [captions, setCaptions] = useState<CaptionPos[]>([]);
  // 明示的に「全部見る」を選んだテーブル。既定に戻せば畳まれるので、
  // 保存はしない（見え方であって、ノートの中身ではない）
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // 宣言順の都合で、折りたたみ判定を effect から参照するための ref
  const isCollapsedRef = useRef<(pos: CaptionPos) => boolean>(() => false);

  // 編集中のテーブルは名前が空でも描画対象に含める必要があるため ref で compute に渡す
  const editingRef = useRef(editing);
  editingRef.current = editing;

  // ⠿ メニューの「テーブルに名前を付ける」からの編集要求を拾う
  const { captionEditRequest, clearCaptionEditRequest } = store;
  useEffect(() => {
    if (!captionEditRequest) return;
    setDraft(store.getCaption(captionEditRequest));
    setEditing(captionEditRequest);
    clearCaptionEditRequest();
  }, [captionEditRequest, clearCaptionEditRequest, store]);

  // テーブルの位置を計算（icon-layer と同じ再試行つき）
  const retryRef = useRef<number | null>(null);
  const compute = useCallback(() => {
    const next: CaptionPos[] = [];
    const editor = editorRef.current;
    if (!editor) {
      if ((store.metas.size > 0 || editingRef.current) && retryRef.current === null) {
        retryRef.current = window.setTimeout(() => {
          retryRef.current = null;
          compute();
        }, 200);
      }
      return;
    }

    let domMissing = false;
    const displayNames = computeTableDisplayNames(
      (editor as any).document ?? [],
      (blockId) => store.hasColumnType(blockId, "datetime-auto"),
      store.getCaption
    );
    const targets = new Set(displayNames.keys());
    // 名前を付ける途中のテーブルは、まだ名前が無くても入力欄を出す
    if (editingRef.current) targets.add(editingRef.current);

    targets.forEach((blockId) => {
      const block = editor.getBlock?.(blockId);
      if (!block || block.type !== "table") return;

      const blockEl = document.querySelector(
        `[data-id="${blockId}"][data-node-type="blockOuter"]`
      );
      if (!blockEl) {
        domMissing = true;
        return;
      }
      const tableEl = blockEl.querySelector("table");
      const rect = (tableEl ?? blockEl).getBoundingClientRect();
      if (rect.top > window.innerHeight) return;
      // 折りたたみ中は table 自体の高さは変わらず、外側の .tableWrapper が
      // 切り詰められる。見えている下端はそちらで測る
      const wrapEl = tableEl?.closest(".tableWrapper");
      const wrapRect = wrapEl?.getBoundingClientRect();
      const visibleBottom = wrapRect ? Math.min(rect.bottom, wrapRect.bottom) : rect.bottom;
      if (visibleBottom < 0) return;
      // 1 行目はヘッダなのでデータ行数から除く
      const rowCount = Math.max(0, (block.content?.rows?.length ?? 1) - 1);
      // 折りたたみ中は表が途中で切れているので、見えている行数から残りを見積もる
      // （行の高さは実測。1 行も測れないときは 0 = 表示しない）
      const rowEl = tableEl?.querySelector("tbody tr");
      const rowHeight = rowEl ? rowEl.getBoundingClientRect().height : 0;
      const visibleHeight = visibleBottom - rect.top;
      const visibleRows =
        rowHeight > 0 ? Math.max(0, Math.floor(visibleHeight / rowHeight) - 1) : rowCount;
      next.push({
        blockId,
        top: rect.top - 24,
        left: rect.left,
        width: rect.width,
        displayName: displayNames.get(blockId) ?? "",
        rowCount,
        bottom: visibleBottom,
        hiddenRows: Math.max(0, rowCount - visibleRows),
      });
    });

    setCaptions(next);

    if (domMissing && retryRef.current === null) {
      retryRef.current = window.setTimeout(() => {
        retryRef.current = null;
        compute();
      }, 200);
    }
  }, [store, editorRef]);

  // 折りたたみ CSS が当たると表の高さが変わる。裾のフェードを正しい位置に置くため、
  // 折りたたみ対象が変わったフレームの後で測り直す（測り直しても対象集合は変わらない
  // ので、ここでループにはならない）
  const collapsedKey = captions
    .filter((pos) => isCollapsedRef.current(pos))
    .map((pos) => pos.blockId)
    .join(",");
  useEffect(() => {
    if (collapsedKey === "") return;
    const id = requestAnimationFrame(() => compute());
    return () => cancelAnimationFrame(id);
  }, [collapsedKey, compute]);

  useEffect(() => {
    return () => {
      if (retryRef.current !== null) {
        window.clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(compute, 50);
    return () => {
      clearTimeout(timer);
      if (retryRef.current !== null) {
        window.clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    };
  }, [compute, editing]);

  useEffect(() => {
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);

    const editorEl = document.querySelector("[data-label-wrapper]");
    let observer: MutationObserver | null = null;
    if (editorEl) {
      observer = new MutationObserver(compute);
      observer.observe(editorEl, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }

    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
      observer?.disconnect();
    };
  }, [compute]);

  const startEditing = (blockId: string) => {
    setDraft(store.getCaption(blockId));
    setEditing(blockId);
  };

  const commit = (blockId: string) => {
    store.setCaption(blockId, draft);
    setEditing(null);
  };

  /** その表を今折りたたんで見せるか（明示的に開かれていない長い取り込み表） */
  const isCollapsed = (pos: CaptionPos) =>
    store.getSource(pos.blockId) != null &&
    pos.rowCount > COLLAPSE_ROW_THRESHOLD &&
    !expanded.has(pos.blockId);
  isCollapsedRef.current = isCollapsed;

  const toggleExpanded = (blockId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
    // 高さが変わるので測り直す。CSS が当たった後のフレームで測る必要がある
    requestAnimationFrame(() => compute());
  };

  if (captions.length === 0) return null;

  // 折りたたみは DOM を触らず CSS で当てる。ProseMirror がテーブルを描き直しても
  // 消えず、書き出し（Markdown / 保存 JSON）にも一切影響しない
  const collapsedCss = captions
    .filter(isCollapsed)
    .map(
      (pos) =>
        // overflow は hidden。スクロールできると「畳まれている」のか
        // 「まだ読み込み中なのか」が曖昧になるので、切れていることを見せて開かせる
        `[data-id="${pos.blockId}"] .tableWrapper{max-height:${COLLAPSED_MAX_HEIGHT}px;overflow:hidden;}`
    )
    .join("");

  return createPortal(
    <>
      {collapsedCss.length > 0 && <style>{collapsedCss}</style>}
      {/* 折りたたみ中の表の裾。下に向かって背景へ溶かし、その上に残りの行数を出す。
          「表がここで終わっている」のではなく「まだ続く」と読めるようにするための表現 */}
      {captions.filter(isCollapsed).map((pos) => (
        <div
          key={`fade-${pos.blockId}`}
          style={{
            position: "fixed",
            left: pos.left,
            width: pos.width,
            top: pos.bottom - FADE_HEIGHT,
            height: FADE_HEIGHT,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            background:
              "linear-gradient(to bottom, transparent, var(--color-background) 85%)",
            zIndex: 49,
          }}
        >
          <button
            type="button"
            onClick={() => toggleExpanded(pos.blockId)}
            style={{
              transform: "translateY(50%)",
              padding: "2px 10px",
              borderRadius: 999,
              border: "1px solid var(--color-border)",
              background: "var(--color-card)",
              color: "var(--color-text-secondary)",
              fontSize: 11,
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
              whiteSpace: "nowrap",
            }}
          >
            {t("tableMeta.showHiddenRows", { count: String(pos.hiddenRows) })}
          </button>
        </div>
      ))}
      {captions.map((pos) => {
        const { blockId, top, left, width, displayName } = pos;
        const name = store.getCaption(blockId);
        if (editing === blockId) {
          return (
            <input
              key={blockId}
              autoFocus
              type="text"
              value={draft}
              placeholder={displayName || t("tableMeta.namePlaceholder")}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(blockId)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commit(blockId);
                if (e.key === "Escape") setEditing(null);
              }}
              style={{
                position: "fixed",
                top,
                left,
                width: Math.max(180, Math.min(width, 360)),
                height: 22,
                padding: "0 6px",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid var(--color-input)",
                background: "var(--color-card)",
                color: "var(--color-foreground)",
                outline: "none",
                zIndex: 50,
              }}
            />
          );
        }
        const source = store.getSource(blockId);
        return (
          <div
            key={blockId}
            style={{
              position: "fixed",
              top,
              left,
              maxWidth: Math.max(180, width),
              height: 22,
              display: "flex",
              alignItems: "center",
              gap: 4,
              zIndex: 50,
            }}
          >
          <button
            type="button"
            onClick={() => startEditing(blockId)}
            title={t("tableMeta.nameHint")}
            style={{
              minWidth: 0,
              height: 22,
              display: "flex",
              alignItems: "center",
              padding: "0 6px",
              margin: 0,
              borderRadius: 6,
              border: "none",
              background: "transparent",
              cursor: "text",
              fontSize: 13,
              // 手で付けた名前は少し立て、自動名（表 N）は控えめに出す
              fontWeight: name ? 500 : 400,
              color: name ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            {displayName || t("tableMeta.namePlaceholder")}
          </button>
          {/* 取り込み由来のテーブルは出所を出す。名前の隣に置くのは、
              この表が手打ちではなく生データ由来だと一目で分かるようにするため。
              押せるのは「取り込み設定を見直す」入口としてで、素材そのものを開く
              経路ではない（ダウンロードに見えるアイコンは付けない） */}
          {source && (() => {
            const clickable = Boolean(onReimport && source.fileId);
            const label = t("dataImport.sourceBadge", { fileName: source.fileName });
            const badgeStyle = {
              display: "flex",
              alignItems: "center",
              height: 18,
              padding: "0 6px",
              margin: 0,
              borderRadius: 9,
              border: "1px solid var(--color-border)",
              background: "transparent",
              color: "var(--color-text-tertiary)",
              fontSize: 10,
              whiteSpace: "nowrap" as const,
              maxWidth: 220,
              overflow: "hidden",
              textOverflow: "ellipsis" as const,
            };
            // 押しても何も起きないボタンは置かない（素材登録に失敗した表だけがこの形）
            if (!clickable) {
              return (
                <span title={sourceTooltip(source, false)} style={badgeStyle}>
                  {label}
                </span>
              );
            }
            return (
              <button
                type="button"
                onClick={() => onReimport?.(blockId, source)}
                title={sourceTooltip(source, true)}
                style={{ ...badgeStyle, cursor: "pointer" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                {label}
              </button>
            );
          })()}
          {/* 長い取り込み表は既定で高さを抑え、ここから全体を出せるようにする。
              数百行の装置ログがそのまま伸びると、本文がデータで埋まってしまう */}
          {source && pos.rowCount > COLLAPSE_ROW_THRESHOLD && (
            <button
              type="button"
              onClick={() => toggleExpanded(blockId)}
              title={
                isCollapsed(pos)
                  ? t("tableMeta.rowsExpandHint")
                  : t("tableMeta.rowsCollapseHint")
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                height: 18,
                padding: "0 6px",
                margin: 0,
                borderRadius: 9,
                border: "1px solid var(--color-border)",
                background: "transparent",
                color: "var(--color-text-tertiary)",
                fontSize: 10,
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              {t("tableMeta.rows", { count: String(pos.rowCount) })}
              {isCollapsed(pos) ? " ▾" : " ▴"}
            </button>
          )}
          </div>
        );
      })}
    </>,
    document.body
  );
}
