// テーブルのキャプション（名前）レイヤー
//
// IndexTableIconLayer と同じパターンで body ポータルに描画する。
// 学術文書の慣例どおりテーブルのキャプションは表の上に置く。名前は tableMeta.caption
// に保存され、チャートブロックが参照テーブルの表示名として使う（eureco の
// 「データテーブル1: 地点Aの観測結果」に相当する、参照に耐える名前）。
//
// 描画対象はすべてのテーブル。名前ボタンを出すのは「名前が付いているテーブル」と
// 「日時が自動で入るテーブル（無名でも 表 N を出す）」だけで、名前の無いふつうの
// テーブルには拡大表示ボタンだけを出す — 名前を付ける入口は ⠿ メニューの
// 「テーブルに名前を付ける」で、そこから編集要求が来たときだけ入力欄を出す。

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2 } from "lucide-react";
import { t, useLocaleSubscription } from "../../i18n";
import { computeTableDisplayNames } from "./auto-name";
import { collectTableBlocks } from "./table-cells";
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
  /** 見えている表の下端（画面座標）。折りたたみ中の「続きがある」表示をここに重ねる */
  bottom: number;
  /** 折りたたむとしたら隠れる行数（0 なら隠す行がない） */
  hiddenRows: number;
};

/**
 * これを超える行数の取り込みテーブルは既定で行を隠す。
 * 装置ログは数百行が普通で、そのまま展開すると本文がデータで埋まり、
 * ノートとしての読み筋が消えてしまう。
 */
const COLLAPSE_ROW_THRESHOLD = 20;
/**
 * 折りたたみ中に見せるデータ行数（ヘッダは別に 1 行見える）。
 * 外側の高さ（max-height）ではなく行そのものを隠すのは、BlockNote の
 * 列追加ボタンが tbody の実寸に合わせて伸びるため — 外枠だけ切り詰めると、
 * 畳んだ表の脇にボタンだけが元の長さで残ってしまう。
 */
const COLLAPSED_VISIBLE_ROWS = 7;
/** 隠し始める行の位置（1 始まり）。1 行目のヘッダ + 見せる行数、の次 */
const FIRST_HIDDEN_ROW = COLLAPSED_VISIBLE_ROWS + 2;
/** 裾のフェードの高さ（px）。この中に「あと N 行」ボタンを浮かせる */
const FADE_HEIGHT = 64;
/**
 * 折りたたみ CSS を、この層が見ているエディタだけに閉じ込めるための印。
 * メインと SidePeek で同じノートを開くと同じ blockId のテーブルが 2 つ並ぶので、
 * blockId だけで書くと片方を開いてももう片方の CSS が畳んだままにしてしまう。
 */
const SCOPE_ATTR = "data-table-fold-scope";

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
  onExpand,
  wrapperEl,
}: {
  editorRef: React.RefObject<any>;
  /**
   * 取り込み由来のテーブルで「取り込み元」バッジを押したときのハンドラ。
   * 素材として残っている元ファイルを読み直し、保存済みの設定でダイアログを開く。
   * 渡されない場合はバッジは表示だけ（ツールチップで出所を示す）になる。
   */
  onReimport?: (blockId: string, source: TableSource) => void;
  /**
   * 拡大表示（⤢）を押したときのハンドラ。ホストが表の中身を読んでモーダルを開く。
   * 渡されない場合はボタン自体を出さない（Storybook の単体表示など）。
   */
  onExpand?: (blockId: string, displayName: string) => void;
  /**
   * この層が見るエディタの外枠（ProvIndicatorLayer と同じ流儀）。
   * SidePeek は自分の wrapper を渡す。省略時は最初の [data-label-wrapper]＝
   * メインエディタを見る（DOM 順でメインが先に出る）。
   */
  wrapperEl?: HTMLElement | null;
}) {
  // 言語切替でラベルを引き直す（モジュールスコープの t() は自前で購読しないと古いまま）
  useLocaleSubscription();
  const store = useTableMetaStore();
  const scopeId = useId();
  // 見ているエディタの外枠。SidePeek が開いていても互いのテーブルを拾わないよう、
  // ブロック探索も折りたたみ CSS もこの中に閉じる
  const resolveRoot = useCallback((): HTMLElement | null => {
    const root = wrapperEl ?? document.querySelector<HTMLElement>("[data-label-wrapper]");
    if (root && root.getAttribute(SCOPE_ATTR) !== scopeId) root.setAttribute(SCOPE_ATTR, scopeId);
    return root;
  }, [wrapperEl, scopeId]);
  const [captions, setCaptions] = useState<CaptionPos[]>([]);
  // キャプションのポータル先。エディタのラッパーそのもの
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
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

    // 外枠がまだ付いていない（SidePeek のマウント直後など）。document 全体に
    // 落とすと隣のエディタのテーブルを拾ってしまうので、付くまで待つ
    const root = resolveRoot();
    if (!root) {
      if (retryRef.current === null) {
        retryRef.current = window.setTimeout(() => {
          retryRef.current = null;
          compute();
        }, 200);
      }
      return;
    }

    let domMissing = false;
    // ラッパー内座標の基準。スクロール量を足すので、スクロールしても測り直さずに済む
    const rootRect = root.getBoundingClientRect();
    setPortalHost((prev) => (prev === root ? prev : root));
    const docBlocks = (editor as any).document ?? [];
    const displayNames = computeTableDisplayNames(docBlocks, store.getCaption);
    // 拡大表示ボタンは名前の有無に関係なく出すので、走査はすべてのテーブルに広げる。
    // 名前ボタンを出すかどうかは描画側が displayName の有無で決める
    const targets = new Set([...collectTableBlocks(docBlocks).keys(), ...displayNames.keys()]);
    // 名前を付ける途中のテーブルは、まだ名前が無くても入力欄を出す
    if (editingRef.current) targets.add(editingRef.current);

    targets.forEach((blockId) => {
      const block = editor.getBlock?.(blockId);
      if (!block || block.type !== "table") return;

      const blockEl = root.querySelector(
        `[data-id="${blockId}"][data-node-type="blockOuter"]`
      );
      if (!blockEl) {
        domMissing = true;
        return;
      }
      const tableEl = blockEl.querySelector("table");
      // 折りたたみ中は隠した行が高さを持たないので、表の下端がそのまま見えている下端になる
      const rect = (tableEl ?? blockEl).getBoundingClientRect();
      // 1 行目はヘッダなのでデータ行数から除く
      const rowCount = Math.max(0, (block.content?.rows?.length ?? 1) - 1);
      next.push({
        blockId,
        top: rect.top - rootRect.top + root.scrollTop - 24,
        left: rect.left - rootRect.left + root.scrollLeft,
        width: rect.width,
        displayName: displayNames.get(blockId) ?? "",
        rowCount,
        bottom: rect.bottom - rootRect.top + root.scrollTop,
        hiddenRows: Math.max(0, rowCount - COLLAPSED_VISIBLE_ROWS),
      });
    });

    setCaptions(next);

    if (domMissing && retryRef.current === null) {
      retryRef.current = window.setTimeout(() => {
        retryRef.current = null;
        compute();
      }, 200);
    }
  }, [store, editorRef, resolveRoot]);

  // 折りたたみ CSS が当たると表の高さが変わる。裾のフェードを正しい位置に置くため、
  // 折りたたみ対象が変わったフレームの後で測り直す。対象集合は「取り込み由来で長い表を
  // 明示的に開いていないか」だけで決まり、画面のどこにあるかには依らないので、
  // 測り直しで集合が変わることはなく、ここでループにはならない
  const collapsedKey = captions
    .filter((pos) => isCollapsedRef.current(pos))
    .map((pos) => pos.blockId)
    .join(",");
  useEffect(() => {
    if (collapsedKey === "") return;
    const id = requestAnimationFrame(() => compute());
    return () => cancelAnimationFrame(id);
  }, [collapsedKey, compute]);

  // 上余白 CSS（marginCss）が当たると表が下がる。層の位置は測った時点の rect なので、
  // 適用対象の集合が変わったフレームの後で測り直す。集合が同じ間は再発火しないため
  // ループにはならない（折りたたみ CSS の測り直しと同じ理屈）
  const marginKey = captions.map((pos) => pos.blockId).join(",");
  useEffect(() => {
    if (marginKey === "") return;
    const id = requestAnimationFrame(() => compute());
    return () => cancelAnimationFrame(id);
  }, [marginKey, compute]);

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

    const editorEl = resolveRoot();
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
  }, [compute, resolveRoot]);

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

  if (captions.length === 0 || !portalHost) return null;

  // ラッパーの中に絶対配置するので、画面外の分は overflow が隠す。
  // 「見えているものだけ描く」間引きは入れない — 折りたたみ CSS と同じ一覧から
  // 引く以上、間引きが CSS 側に漏れると表が伸び縮みしてスクロールが跳ねる（#716）
  const visibleCaptions = captions;

  // 折りたたみは DOM を触らず CSS で当てる。ProseMirror がテーブルを描き直しても
  // 消えず、書き出し（Markdown / 保存 JSON）にも一切影響しない。
  // 画面外の表も含めて当てる — スクロールで CSS が付いたり外れたりすると表の高さが
  // 変わり、ブラウザのスクロールアンカーが位置を保とうとして scrollTop が跳ぶ（#716）
  const collapsedCss = captions
    .filter(isCollapsed)
    .map(
      (pos) =>
        // 外枠の高さを抑えるのではなく行そのものを隠す。表の実寸が縮むので、
        // BlockNote が表の脇・下に出す列／行の追加ボタンも一緒に縮む
        `[${SCOPE_ATTR}="${scopeId}"] [data-id="${pos.blockId}"] .tableWrapper tbody tr:nth-child(n+${FIRST_HIDDEN_ROW}){display:none;}`
    )
    .join("");

  // キャプション行（名前・⤢）は表の上に浮かぶ層で、ブロック自体の余白は変わらない。
  // そのままだと前の段落とキャプションが密着するので、行の高さぶんだけ表ブロックに
  // 上余白を足す。画面外の表も含めて全件に当てる — スクロールで付け外しすると
  // 表の位置が跳ぶ（折りたたみ CSS と同じ理由。#716）。適用で表が下がった分は
  // MutationObserver → compute の再計測が拾って層も追随する
  const marginCss = captions
    .map(
      (pos) =>
        `[${SCOPE_ATTR}="${scopeId}"] [data-id="${pos.blockId}"][data-node-type="blockOuter"]{margin-top:26px;}`
    )
    .join("");

  return createPortal(
    <>
      <style>{marginCss + collapsedCss}</style>
      {/* 折りたたみ中の表の裾。下に向かって背景へ溶かし、その上に残りの行数を出す。
          「表がここで終わっている」のではなく「まだ続く」と読めるようにするための表現 */}
      {visibleCaptions.filter(isCollapsed).map((pos) => (
        <div
          key={`fade-${pos.blockId}`}
          style={{
            position: "absolute",
            left: pos.left,
            width: pos.width,
            top: pos.bottom - FADE_HEIGHT,
            height: FADE_HEIGHT,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            background:
              "linear-gradient(to bottom, transparent, var(--color-background) 85%)",
            zIndex: 4,
            // 裾は表の最後の行に重なる。素通しにしないとそこだけ選択・編集できない
            pointerEvents: "none",
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
              // 素通しの裾の中で、このボタンだけはクリックを受け取る
              pointerEvents: "auto",
            }}
          >
            {t("tableMeta.showHiddenRows", { count: String(pos.hiddenRows) })}
          </button>
        </div>
      ))}
      {visibleCaptions.map((pos) => {
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
                position: "absolute",
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
                zIndex: 5,
              }}
            />
          );
        }
        const source = store.getSource(blockId);
        return (
          <div
            key={blockId}
            style={{
              position: "absolute",
              top,
              left,
              maxWidth: Math.max(180, width),
              height: 22,
              display: "flex",
              alignItems: "center",
              gap: 4,
              // 本文の装飾なので、モーダル（z-50）より下に置く。
              // 同じ高さだと body ポータルの描画順でモーダルの上に乗る
              zIndex: 5,
            }}
          >
          {/* 名前ボタンは名前（自動名含む）が付いた表だけ。無名の表は拡大表示だけ出す */}
          {displayName !== "" && (
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
            {displayName}
          </button>
          )}
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
          {/* 拡大表示。大きな表を本文の幅に縛られずに眺めるための入口で、
              どのテーブルにも出す（無名の表では唯一の要素になる） */}
          {onExpand && (
            <button
              type="button"
              onClick={() => onExpand(blockId, displayName)}
              title={t("tableMeta.expand")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 18,
                height: 18,
                padding: 0,
                margin: 0,
                borderRadius: 9,
                border: "1px solid var(--color-border)",
                background: "transparent",
                color: "var(--color-text-tertiary)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              <Maximize2 size={10} strokeWidth={2} />
            </button>
          )}
          </div>
        );
      })}
    </>,
    // ラッパーの中に描く。overflow がはみ出しを隠し、z-index もこの中に閉じるので、
    // 開いているメニューを覆わない。スクロールはコンテナごと動くので追随のずれも出ない
    portalHost,
  );
}
