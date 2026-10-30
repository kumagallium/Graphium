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
import { CalendarClock, Calculator, FileText, Lock, Maximize2 } from "lucide-react";
import { t, useLocaleSubscription } from "../../i18n";
import { computeTableDisplayNames } from "./auto-name";

// 名前付きの表（キャプション行を持つブロック）の id。複数ブロック選択の塗りが、
// 上余白に浮かぶキャプション行まで塗るために読む。DOM に印を付けない代わりの共有
const captionedBlockIds = new Set<string>();
export function getCaptionedBlockIds(): ReadonlySet<string> {
  return captionedBlockIds;
}
function setCaptionedBlockIds(ids: string[]): void {
  captionedBlockIds.clear();
  for (const id of ids) captionedBlockIds.add(id);
}
import { collectTableBlocks } from "./table-cells";
import { calcWrittenCells, type CalcCellWrite } from "./calc-cells";
import { useTableMetaStore } from "./store";
import { findColumnNameByType, hasColumnType, type TableSource } from "./types";
import { DOC_TABLE_DEFAULT_MAX_ROWS } from "../data-import/target";

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
  /** 計算ブロックが値を入れたセル（row は rows の添字で 1 以上）。電卓の印を付ける */
  calcCells: { row: number; col: number }[];
};

/**
 * 計算が入れたセルの印（lucide の Calculator）。CSS の mask で描くので、色はテーマの
 * 変数から取れる。小さく描くと点のボタンは潰れるが、電卓の外形だけ読めれば足りる
 */
const CALC_CELL_ICON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='16' height='20' x='4' y='2' rx='2'/%3E%3Cline x1='8' x2='16' y1='6' y2='6'/%3E%3Cpath d='M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01M16 18h.01'/%3E%3C/svg%3E\")";

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
  onConvertToDataTable,
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
   * 行が多い表に出す「データ表にする」を押したときのハンドラ。ホストが表を CSV の素材に
   * 書き出し、ブロックをデータ表に置き換える（本文から行が消えて軽くなる）
   */
  onConvertToDataTable?: (blockId: string) => void;
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
  // 保護された列を編集しようとして弾かれた表（🔒 バッジを少しのあいだ目立たせる）
  const [flashedProtected, setFlashedProtected] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onBlocked = (e: Event) => {
      const id = (e as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (!id) return;
      setFlashedProtected(id);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setFlashedProtected(null), 1200);
    };
    window.addEventListener("graphium:protected-edit-blocked", onBlocked);
    return () => {
      window.removeEventListener("graphium:protected-edit-blocked", onBlocked);
      if (timer) clearTimeout(timer);
    };
  }, []);
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
    // 計算ブロックの書き戻し宣言を表ごとにまとめる（どのセルに電卓の印を付けるか）
    const writesByTable = new Map<string, CalcCellWrite[]>();
    for (const requests of Object.values(store.calcWritebacks ?? {})) {
      for (const req of requests as CalcCellWrite[]) {
        if (!req?.tableBlockId) continue;
        const list = writesByTable.get(req.tableBlockId) ?? [];
        list.push(req);
        writesByTable.set(req.tableBlockId, list);
      }
    }

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
        calcCells: calcWrittenCells(block, writesByTable.get(blockId) ?? []),
      });
    });

    // 名前付きの表の id を共有する（選択枠を伸ばす CSS と、複数ブロック選択の塗りが読む）。
    // DOM に属性を書いてはいけない: .bn-block-outer は ProseMirror が管理する DOM で、
    // 外から付けた属性は再描画で剥がされ、その変更を拾ってまた付ける無限ループになる
    // （v0.62.0 の回帰。キャプション付きの表があるノートが固まった）
    setCaptionedBlockIds(next.map((pos) => pos.blockId));

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
    // 位置を測る基準の箱（エディタの外枠）の寸法変化。右パネルの幅をドラッグすると、
    // 用紙（A4）は枠の中で中央寄せなので用紙ごと左右に動くが、スクロールも window の resize も
    // DOM の変化も起きない。箱の幅が変わったフレームで 1 回だけ測り直す（rAF でまとめる）。
    // window の resize を流す方式は、ほかの幅の再計算を巻き込むので取らない。
    let resizeObserver: ResizeObserver | null = null;
    let resizeRaf: number | null = null;
    if (editorEl && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        if (resizeRaf !== null) return;
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          compute();
        });
      });
      resizeObserver.observe(editorEl);
    }
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
      resizeObserver?.disconnect();
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
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
  // MutationObserver → compute の再計測が拾って層も追随する。
  // transition:none が要る: BlockNote は .bn-block-outer に transition: margin 0.2s を掛けており
  // （@blocknote/core の Block.css）、上余白が 0 → 26px へ 200ms かけて動く。適用の直後（次のフレーム）に
  // 来歴ラベルのチップの位置を測ると、まだ動いている途中の値で測ってしまい、その後は何も
  // 測り直しの契機が無くて、チップが表の上余白（26px × 表の通し番号）ぶん上にずれたまま残る
  // （ウィンドウの resize を 1 回起こすと直る、という症状で出ていた）。余白は即時に効かせる
  const marginCss = captions
    .map(
      (pos) =>
        `[${SCOPE_ATTR}="${scopeId}"] [data-id="${pos.blockId}"][data-node-type="blockOuter"]{margin-top:26px;transition:none;}`
    )
    .join("");
  // 名前付きの表を選んだときの枠。キャプション行はブロックの上余白（26px）に浮かんでいるので、
  // 本文の枠（.bn-block-content の outline）では覆えない。::before を上に伸ばして描く
  const ringCss = captions
    .map((pos) => {
      const outer = `[${SCOPE_ATTR}="${scopeId}"] [data-id="${pos.blockId}"][data-node-type="blockOuter"]`;
      const selected = `${outer}:has(> .bn-block > .bn-block-content[data-content-type="table"].ProseMirror-selectednode)`;
      return (
        `${selected}{position:relative;}` +
        `${selected}::before{content:"";position:absolute;left:-2px;right:-2px;top:-26px;bottom:-2px;` +
        `border:2px solid color-mix(in oklab, var(--color-primary) 35%, transparent);border-radius:6px;pointer-events:none;}` +
        `${outer} > .bn-block > .bn-block-content[data-content-type="table"].ProseMirror-selectednode > *{outline:none;}`
      );
    })
    .join("");

  // ノートへのリンクの列（先頭列）は各行の名前なので、行見出しとして見せる。
  // 1 行目（列見出し）と同じ色にして、「この列が行の名前」だと一目で分かるようにする。
  // 色は app.css の「テーブルのヘッダー行」と揃える（あちらを変えるならこちらも）
  const rowHeaderCss = captions
    .filter((pos) => hasColumnType(store.metas.get(pos.blockId), "note-link"))
    .map(
      (pos) =>
        `[${SCOPE_ATTR}="${scopeId}"] [data-id="${pos.blockId}"] .tableWrapper tr td:first-child{font-weight:600;background-color:#f0f5ef;color:#2d4a32;}`
    )
    .join("");

  // 計算ブロックが値を入れたセルに電卓の小さな印を付ける。印の無いセルは人が書いた値、
  // と表だけ見て分かるようにするため（基準行を飛ばす書き戻しでは、同じ列に両方が並ぶ）。
  // セルは ProseMirror の DOM なので属性は書かず、行・列の位置で CSS を当てる
  const calcCellSelectors = captions.flatMap((pos) =>
    pos.calcCells.map(
      ({ row, col }) =>
        `[${SCOPE_ATTR}="${scopeId}"] [data-id="${pos.blockId}"] .tableWrapper tbody > tr:nth-child(${row + 1}) > :nth-child(${col + 1})`
    )
  );
  const calcCellCss =
    calcCellSelectors.length === 0
      ? ""
      : `${calcCellSelectors.join(",")}{position:relative;}` +
        `${calcCellSelectors.map((s) => `${s}::after`).join(",")}{content:"";position:absolute;top:4px;right:4px;width:9px;height:9px;` +
        `background-color:var(--color-text-tertiary);opacity:0.6;pointer-events:none;` +
        `-webkit-mask:${CALC_CELL_ICON} center/contain no-repeat;mask:${CALC_CELL_ICON} center/contain no-repeat;` +
        `-webkit-print-color-adjust:exact;print-color-adjust:exact;}`;

  return createPortal(
    <>
      <style data-table-caption-css="">{marginCss + ringCss + collapsedCss + calcCellCss + rowHeaderCss}</style>
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
              // 編集中も名前の行として実幅を測らせる（来歴ラベルのチップが入力欄と重ならない）
              data-table-caption-row={blockId}
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
            // 来歴ラベルのチップが、狭い表でこの行と重ならないよう実幅を測る目印
            // （context-label/prov-indicator.tsx が読む）
            data-table-caption-row={blockId}
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
            data-tooltip={t("tableMeta.nameHint")}
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
          {/* 計算ブロックからの書き戻しバッジ。「どの列 ← どの計算」を表側からも
              見えるようにする。クリックでその計算ブロックへ移動する */}
          {(() => {
            const writers: { calcId: string; column: string; calcName?: string }[] = [];
            for (const [calcId, requests] of Object.entries(store.calcWritebacks ?? {})) {
              for (const req of requests as { tableBlockId?: string; column?: string; calcName?: string }[]) {
                if (req?.tableBlockId === blockId && req.column) {
                  writers.push({ calcId, column: req.column, calcName: req.calcName });
                }
              }
            }
            if (writers.length === 0) return null;
            return writers.map((w) => (
              <button
                key={`${w.calcId}-${w.column}`}
                type="button"
                data-tooltip={t("tableMeta.calcWriterHint")}
                onClick={() => {
                  document
                    .querySelector(`[data-id="${w.calcId}"]`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  height: 18,
                  padding: "0 6px",
                  margin: 0,
                  borderRadius: 9,
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                  color: "var(--color-text-tertiary)",
                  fontSize: 10,
                  whiteSpace: "nowrap",
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <Calculator size={10} strokeWidth={2} />
                {t("tableMeta.calcWriterBadge", {
                  column: w.column,
                  name: w.calcName || t("calc.label"),
                })}
              </button>
            ));
          })()}
          {/* 列の属性のバッジ。計算ブロックの書き戻しバッジと同じ形で、どの列に何が付いて
              いるかを表の名前の横に出す（ノートへのリンク・日時を自動で入れる） */}
          {(() => {
            const meta = store.metas.get(blockId);
            const badges: { key: string; icon: React.ReactNode; column: string; hint: string }[] = [];
            if (hasColumnType(meta, "note-link")) {
              badges.push({
                key: "note-link",
                icon: <FileText size={10} strokeWidth={2} />,
                column: findColumnNameByType(meta, "note-link") ?? "",
                hint: t("tableMeta.noteLinkBadgeHint"),
              });
            }
            if (hasColumnType(meta, "datetime-auto")) {
              badges.push({
                key: "datetime-auto",
                icon: <CalendarClock size={10} strokeWidth={2} />,
                column: findColumnNameByType(meta, "datetime-auto") ?? "",
                hint: t("tableMeta.dateTimeBadgeHint"),
              });
            }
            // 保護は列ごとに 1 つ（計算が書くセルは電卓の印で分かるので、ここは明示の保護だけ）
            const protectedNames = Object.entries(meta?.columns ?? {})
              .filter(([name, types]) => name !== "" && types.includes("protected"))
              .map(([name]) => name);
            const flash = flashedProtected === blockId;
            const normal = badges.map((b) => (
              <span
                key={b.key}
                data-tooltip={b.hint}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  height: 18,
                  padding: "0 6px",
                  margin: 0,
                  borderRadius: 9,
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-tertiary)",
                  fontSize: 10,
                  whiteSpace: "nowrap",
                  maxWidth: 160,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {b.icon}
                {b.column}
              </span>
            ));
            const locks = protectedNames.map((name) => (
              <span
                key={`protected-${name}`}
                data-protected-badge=""
                data-tooltip={t("tableMeta.protectedBadgeHint")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  height: 18,
                  padding: "0 6px",
                  margin: 0,
                  borderRadius: 9,
                  border: flash ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
                  background: flash ? "color-mix(in oklch, var(--color-primary) 14%, transparent)" : "transparent",
                  color: flash ? "var(--color-primary)" : "var(--color-text-tertiary)",
                  transition: "background 0.2s, border-color 0.2s, color 0.2s",
                  fontSize: 10,
                  whiteSpace: "nowrap",
                  maxWidth: 160,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <Lock size={10} strokeWidth={2} />
                {name}
              </span>
            ));
            return [...normal, ...locks];
          })()}
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
                <span data-tooltip={sourceTooltip(source, false)} style={badgeStyle}>
                  {label}
                </span>
              );
            }
            return (
              <button
                type="button"
                onClick={() => onReimport?.(blockId, source)}
                data-tooltip={sourceTooltip(source, true)}
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
          {/* 行が多い表は編集のたびに文書全体が直列化されて重い。素材にしてデータ表へ
              置き換える入口を、重さの目安（200 行）を超えた表にだけ出す */}
          {onConvertToDataTable && pos.rowCount > DOC_TABLE_DEFAULT_MAX_ROWS && (
            <button
              type="button"
              onClick={() => onConvertToDataTable(blockId)}
              data-tooltip={t("tableMeta.toDataTableHint")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
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
              {t("tableMeta.toDataTable")}
            </button>
          )}
          {/* 長い取り込み表は既定で高さを抑え、ここから全体を出せるようにする。
              数百行の装置ログがそのまま伸びると、本文がデータで埋まってしまう */}
          {source && pos.rowCount > COLLAPSE_ROW_THRESHOLD && (
            <button
              type="button"
              onClick={() => toggleExpanded(blockId)}
              data-tooltip={
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
              aria-label={t("tableMeta.expand")}
              data-tooltip={t("tableMeta.expand")}
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
