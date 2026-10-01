// A4 の用紙の改ページの目安の線
//
// 印刷でページが変わる位置へ、用紙の後ろの机（灰色）に点線を引き、右の机に「2 ページ」などの番号を出す。
// 本文・用紙の上には何も重ねない（点線が本文に被って邪魔にならないように）。1 ページ目には出さない。
// 位置は印刷と同じ木を画面外に組んで測った結果（measure-print-layout.ts）で、
// 目安であり、印刷と数行ずれることがある。
//
// 構造:
//   - 用紙の中には高さ 0 の目印（anchor）だけを置く（測りの基準。何も描かない）。
//   - 線と番号は、PaperFrame が机（根）の中に用意した層（data-paper-desk-layer）へ portal で描く。
//     線は用紙の左右の机の幅だけに引く（用紙の外側にだけ描くので、紙と重ならない）。
//   - 右の机が番号に足りないとき（用紙がぎりぎり入る幅）は、番号だけ用紙の右の余白の中に置く。
//     用紙は不透明なので机の層からは見えない。そのため、この番号は目印（用紙の中）へ描く。
// pointer-events: none・aria-hidden で、本文の操作を邪魔しない。
// ProseMirror の DOM には何も書かない（属性もクラスも足さない。読むだけ）。
// 用紙のときだけ描く（PaperFrame の overlay として、用紙の先頭に差し込まれる）。
// 流れる本文・サイドピーク・共有の閲覧・モバイルでは用紙にならないので出ない。

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n";
import { PAPER_SHEET_ATTR } from "../../lib/pane-layout";
import { collectPageBlocks, measurePageBreaks } from "./measure-print-layout";
import { placeBreaksOnScreen, type GuideLine } from "./page-breaks";
import {
  PAGE_NUMBER_FONT_PX,
  PAGE_NUMBER_GAP_PX,
  PAPER_WIDTH_PX,
  estimatePageNumberWidth,
  resolvePageNumberPlacement,
} from "./paper-layout";

/** 本文が変わってから測り直すまでの待ち（ms）。打っている最中は何度でも先送りする */
const REMEASURE_DELAY_MS = 800;
/** 最初の測りまでの待ち（ms）。エディタが組み上がるのを待つ */
const FIRST_MEASURE_DELAY_MS = 300;

/** 畳んだ見出しの中身に付く class（collapsible-heading）。切り替わりだけが改ページを変える */
const HIDDEN_CLASS = "gph-heading-hidden";

export type PageGuidesProps = {
  /** ノートの題名（印刷の 1 ページ目の見出し部分の高さに効く） */
  title: string;
  /** 印刷の見出し部分に並ぶラベル（ブロック id → ラベル。高さに効く） */
  labels?: Map<string, string>;
};

/** 机の中の層の属性（PaperFrame が置く） */
const DESK_LAYER_ATTR = "data-paper-desk-layer";

/** 線の濃さ。机（--paper-3）の上で見える濃さ（--ink-4 の 70%） */
const LINE_OPACITY = 0.7;

/**
 * 描くだけの部品（ストーリー・テスト用に分けてある）。層（机の根と同じ大きさ）いっぱいに広がる。
 * top は机の根（PaperFrame の根）の上端からの px。
 * 線は用紙の左右の机にだけ引く（用紙は枠の中央・幅 210mm）。
 */
export function PageGuidesLayer({
  lines,
  paperHost = null,
  paperHostOffset = 0,
}: {
  lines: GuideLine[];
  /** 用紙の中の目印。机に番号が入らないときの番号をここへ描く（用紙より手前に出すため） */
  paperHost?: HTMLElement | null;
  /** 目印の上端の、机の根の上端からの距離（px）。目印の中の top = 線の top - これ */
  paperHostOffset?: number;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  // 層の幅（= 机の根の幅）。右の机が番号に足りるかの判定に使う。測れるまでは机に置く
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.offsetWidth;
      setWidth((prev) => {
        const next = w > 0 ? w : null;
        return prev === next ? prev : next;
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 畳んだ見出しの中で何ページも変わると、同じ y に何本も重なる。番号が重ならないよう段にする
  const seen = new Map<number, number>();
  // 用紙の左右の机の幅 = (層の幅 - 用紙) / 2。用紙の右端 = (層の幅 + 用紙) / 2
  const side = `calc((100% - ${PAPER_WIDTH_PX}px) / 2)`;
  const paperRight = `calc((100% + ${PAPER_WIDTH_PX}px) / 2)`;
  const line = {
    position: "absolute",
    top: 0,
    width: side,
    height: 0,
    borderTop: "1px dashed var(--ink-4)",
    opacity: LINE_OPACITY,
  } as const;
  return (
    <div ref={rootRef} data-page-guides-layer="" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {lines.map((l) => {
        const key = Math.round(l.top);
        const stack = seen.get(key) ?? 0;
        seen.set(key, stack + 1);
        const label = t("paper.pageGuide", { n: String(l.page) });
        const placement = resolvePageNumberPlacement(width, estimatePageNumberWidth(label));
        return (
          <div
            key={l.page}
            data-page-guide={l.page}
            style={{ position: "absolute", left: 0, right: 0, top: l.top, height: 0, pointerEvents: "none" }}
          >
            <div data-guide-line="left" style={{ ...line, left: 0 }} />
            <div data-guide-line="right" style={{ ...line, right: 0 }} />
            {placement === "desk" && (
              <span
                data-guide-number="desk"
                className="text-muted-foreground"
                style={{
                  position: "absolute",
                  // 机: 用紙の右端から 8px。線の高さに縦中央。重なる分は下へ段にする
                  // 塗りの左右 4px の分だけ左へずらし、文字は用紙の右端から 8px のまま
                  left: `calc(${paperRight} + ${PAGE_NUMBER_GAP_PX - 4}px)`,
                  top: stack * (PAGE_NUMBER_FONT_PX + 3),
                  transform: "translateY(-50%)",
                  fontSize: PAGE_NUMBER_FONT_PX,
                  lineHeight: "12px",
                  whiteSpace: "nowrap",
                  // 机と同じ色で塗り、点線が文字の上を通らないようにする（線は番号の後ろで途切れて見える）
                  background: "var(--paper-3)",
                  padding: "0 4px",
                }}
              >
                {label}
              </span>
            )}
            {placement === "paper" &&
              paperHost &&
              createPortal(
                <span
                  data-guide-number="paper"
                  data-guide-number-page={l.page}
                  aria-hidden="true"
                  className="text-muted-foreground"
                  style={{
                    position: "absolute",
                    // .bn-editor は position: relative で不透明な背景を持ち、DOM でも後ろにある。
                    // z-index が無いと番号がエディタの背景に塗りつぶされて見えない
                    zIndex: 1,
                    // 用紙の右の余白の中（用紙の右端の内側 8px・右寄せ）。本文には重ならない
                    right: PAGE_NUMBER_GAP_PX,
                    top: l.top - paperHostOffset + stack * (PAGE_NUMBER_FONT_PX + 3),
                    transform: "translateY(-50%)",
                    fontSize: PAGE_NUMBER_FONT_PX,
                    lineHeight: "12px",
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                  }}
                >
                  {label}
                </span>,
                paperHost,
              )}
          </div>
        );
      })}
    </div>
  );
}

function sameLines(a: GuideLine[], b: GuideLine[]): boolean {
  return a.length === b.length && a.every((l, i) => l.page === b[i].page && Math.abs(l.top - b[i].top) < 0.5);
}

export function PageGuides({ title, labels }: PageGuidesProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);
  const [anchorOffset, setAnchorOffset] = useState(0);
  const [lines, setLines] = useState<GuideLine[]>([]);
  // 机の中の層（PaperFrame が用紙の前に置く）。見つかるまでは何も描かない
  const [deskLayer, setDeskLayer] = useState<HTMLElement | null>(null);
  // 題名・ラベルは測り直しの引き金にするだけで、観測の組み直しは起こさない
  const inputRef = useRef({ title, labels });
  inputRef.current = { title, labels };
  const scheduleRef = useRef<((delay: number) => void) | null>(null);
  // ラベルは並び（重複を除いた一覧）が変わったときだけ高さが変わる
  const labelsKey = labels ? [...new Set(labels.values())].sort().join("\u0000") : "";

  useEffect(() => {
    const anchor = anchorRef.current;
    const sheet = anchor?.closest<HTMLElement>(`[${PAPER_SHEET_ATTR}]`);
    if (!anchor || !sheet) return;
    const desk = sheet.parentElement;
    setDeskLayer(desk?.querySelector<HTMLElement>(`:scope > [${DESK_LAYER_ATTR}]`) ?? null);

    let disposed = false;
    let timer: number | null = null;
    let seq = 0;

    const compute = async () => {
      const editor = sheet.querySelector<HTMLElement>(".bn-editor");
      if (!editor) {
        setLines((prev) => (prev.length === 0 ? prev : []));
        return;
      }
      const mine = ++seq;
      const breaks = await measurePageBreaks({
        title: inputRef.current.title,
        editorElement: editor,
        labels: inputRef.current.labels,
        paperSize: "a4",
      });
      // 測っている間にまた本文が変わった／外れた
      if (disposed || mine !== seq) return;
      const screenBlocks = collectPageBlocks(editor, anchor.getBoundingClientRect().top);
      // 線の高さは机の根の上端から測る（= 用紙の上端からの位置 + 用紙の机の中での上端）。
      // 目印は用紙の内側にあるので、目印の根からの距離を足す
      const anchorTop = anchor.getBoundingClientRect().top;
      const deskTop = desk ? desk.getBoundingClientRect().top : anchorTop;
      const offset = anchorTop - deskTop;
      const next = placeBreaksOnScreen(screenBlocks, breaks).map((l) => ({
        ...l,
        top: l.top + offset,
      }));
      setAnchorOffset((prev) => (Math.abs(prev - offset) < 0.5 ? prev : offset));
      setLines((prev) => (sameLines(prev, next) ? prev : next));
    };

    // 打っている最中に重い処理を走らせない: 待ってから、ブラウザが手すきのときに測る
    const schedule = (delay: number) => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        const run = () => {
          if (!disposed) void compute();
        };
        if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 1000 });
        else run();
      }, delay);
    };
    scheduleRef.current = schedule;

    // 本文の変更（文字・ブロックの出入り・見出しの畳み/開き）。見た目に関わらない class
    // （選択・フォーカス）の付け外しでは測り直さない。自分（目印の中）の変化も無視する
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        const target = r.target instanceof Element ? r.target : r.target.parentElement;
        if (!target || anchor.contains(target) || !target.closest(".bn-editor")) continue;
        if (r.type === "attributes") {
          const was = (r.oldValue ?? "").split(/\s+/).includes(HIDDEN_CLASS);
          if (was === target.classList.contains(HIDDEN_CLASS)) continue;
        }
        schedule(REMEASURE_DELAY_MS);
        return;
      }
    });
    mo.observe(sheet, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class"],
      attributeOldValue: true,
    });

    // 画像・フォントの読み込みが終わると行の高さが変わる（load は伝わらないので捕捉で拾う）
    const onLoad = () => schedule(REMEASURE_DELAY_MS);
    sheet.addEventListener("load", onLoad, true);
    sheet.addEventListener("error", onLoad, true);
    const fonts = document.fonts;
    fonts?.addEventListener?.("loadingdone", onLoad);
    void fonts?.ready?.then(() => {
      if (!disposed) schedule(FIRST_MEASURE_DELAY_MS);
    });

    schedule(FIRST_MEASURE_DELAY_MS);
    return () => {
      disposed = true;
      scheduleRef.current = null;
      if (timer !== null) window.clearTimeout(timer);
      mo.disconnect();
      sheet.removeEventListener("load", onLoad, true);
      sheet.removeEventListener("error", onLoad, true);
      fonts?.removeEventListener?.("loadingdone", onLoad);
    };
  }, []);

  // 題名・ラベルが変わった
  useEffect(() => {
    scheduleRef.current?.(REMEASURE_DELAY_MS);
  }, [title, labelsKey]);

  return (
    <div
      ref={(el) => {
        anchorRef.current = el;
        setAnchorEl((prev) => (prev === el ? prev : el));
      }}
      aria-hidden="true"
      data-page-guides=""
      // 測りの基準になる高さ 0 の目印。何も描かない（線と番号は机の中の層へ）
      style={{ position: "relative", height: 0, pointerEvents: "none" }}
    >
      {deskLayer && createPortal(<PageGuidesLayer lines={lines} paperHost={anchorEl} paperHostOffset={anchorOffset} />, deskLayer)}
    </div>
  );
}
