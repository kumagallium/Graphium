// A4 の用紙の改ページの目安の線
//
// 用紙の上に、印刷でページが変わる位置へ点線を引き、右の余白に「2 ページ」などの番号を出す。
// 1 ページ目には出さない。位置は印刷と同じ木を画面外に組んで測った結果（measure-print-layout.ts）で、
// 目安であり、印刷と数行ずれることがある。
//
// 重ね描きの層で、用紙の要素の中の高さ 0 の目印（position: relative）の子として absolute に置く。
// pointer-events: none・aria-hidden で、本文の操作を邪魔しない。
// ProseMirror の DOM には何も書かない（属性もクラスも足さない。読むだけ）。
// 用紙のときだけ描く（PaperFrame の overlay として、用紙の先頭に差し込まれる）。
// 流れる本文・サイドピーク・共有の閲覧・モバイルでは用紙にならないので出ない。

import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { PAPER_SHEET_ATTR } from "../../lib/pane-layout";
import { collectPageBlocks, measurePageBreaks } from "./measure-print-layout";
import { placeBreaksOnScreen, type GuideLine } from "./page-breaks";

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

/** 描くだけの部品（ストーリー・テスト用に分けてある）。y は用紙の目印の上端からの px */
export function PageGuidesLayer({ lines }: { lines: GuideLine[] }) {
  const t = useT();
  // 畳んだ見出しの中で何ページも変わると、同じ y に何本も重なる。番号が重ならないよう段にする
  const seen = new Map<number, number>();
  return (
    <>
      {lines.map((line) => {
        const key = Math.round(line.top);
        const stack = seen.get(key) ?? 0;
        seen.set(key, stack + 1);
        return (
          <div
            key={line.page}
            data-page-guide={line.page}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: line.top,
              height: 0,
              borderTop: "1px dashed var(--ink-4)",
              opacity: 0.7,
              pointerEvents: "none",
            }}
          >
            <span
              className="text-muted-foreground"
              style={{
                position: "absolute",
                right: 8,
                bottom: 3 + stack * 14,
                fontSize: 11,
                lineHeight: "12px",
                whiteSpace: "nowrap",
              }}
            >
              {t("paper.pageGuide", { n: String(line.page) })}
            </span>
          </div>
        );
      })}
    </>
  );
}

function sameLines(a: GuideLine[], b: GuideLine[]): boolean {
  return a.length === b.length && a.every((l, i) => l.page === b[i].page && Math.abs(l.top - b[i].top) < 0.5);
}

export function PageGuides({ title, labels }: PageGuidesProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<GuideLine[]>([]);
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
      const next = placeBreaksOnScreen(screenBlocks, breaks);
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
      ref={anchorRef}
      aria-hidden="true"
      data-page-guides=""
      // z-index: 1 は本文（.bn-editor。position: relative で背景を持つ）の上に線を出すため。
      // 本文の操作は pointer-events: none で通す。BlockNote のメニューは z-index がもっと高い
      style={{ position: "relative", zIndex: 1, height: 0, pointerEvents: "none" }}
    >
      <PageGuidesLayer lines={lines} />
    </div>
  );
}
