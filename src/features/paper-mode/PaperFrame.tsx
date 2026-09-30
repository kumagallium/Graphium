// A4 の用紙の幅で書く表示 — 本文の外枠
//
// standard: 今の流れる本文（最大幅 828px の中央カラム。fullWidth なら幅いっぱい）。
// a4: 机の色の上に用紙（幅 210mm・上下の余白 15mm・薄い影と罫線・最小の高さ 297mm）を置き、
//     本文の幅を印刷と同じ 180mm にする（左の溝は見出しのハンドルまで収めるため 76px、
//     右で調整）。改ページはしない（流れる本文のまま）。
//
// 枠が「用紙 + 左右の机」より狭いときは紙の見た目をやめて流れる本文に戻し、上部に
// 右上に小さなアイコンを出す（説明はホバーで）。縮めて見せる（transform: scale / CSS zoom）ことはしない
// （本文に重ねて描く部品の位置がずれる。画面の拡大縮小を WebView のズームに
// 切り替えたのと同じ理由）。
//
// 使い方は 2 通り:
//   - アプリ（note-app）: paneEl に本文枠（[data-label-wrapper]）を渡す。枠の幅は本文枠の幅で
//     測り、本文枠が持つ余白（padding）は bleed で打ち消して机を本文枠いっぱいに広げる。
//     standard / flow のときは今の本文の DOM と同じ（中央カラムの div 1 枚 + 外側の素の div）。
//     エディタを作り直さないため、mode を切り替えても子の親要素は変わらない。
//   - ストーリー: paneEl を渡さない。外枠の幅を測り、外枠が自前の余白を持つ。

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FileX } from "lucide-react";
import { useT } from "../../i18n";
import { PAPER_SHEET_ATTR } from "../../lib/pane-layout";
import {
  DESK_MARGIN_BLOCK_PX,
  DESK_MARGIN_PX,
  FLOW_MAX_WIDTH_PX,
  PAPER_GUTTER_LEFT_PX,
  PAPER_GUTTER_RIGHT_PX,
  resolvePaperLayout,
  shouldShowNarrowNotice,
  type PaperLayout,
  type PaperMode,
} from "./paper-layout";
import "./paper-frame.css";

// CSS カスタムプロパティ（--*）を含む style
type VarStyle = CSSProperties & Record<`--${string}`, string>;

/** 本文枠の padding（px）。用紙の机をこの分だけ外へ広げる */
export type PaperBleed = { top: number; right: number; bottom: number; left: number };

export type PaperFrameProps = {
  mode: PaperMode;
  /**
   * タイトル・文脈タグ・エディタ。タイトル等の左右は
   * var(--gph-gutter-left, 54px)（左）と var(--gph-gutter-right, 54px)（右）に揃える
   * （note-app の本文枠が渡す変数。用紙のときはこの部品が用紙の値で上書きする）
   */
  children: ReactNode;
  /**
   * アプリに組み込むとき、枠の幅を測る本文枠。null は「まだ mount されていない」で、
   * 測れるまでは流れる本文にしておく。渡さない（undefined）とストーリーの使い方になる。
   */
  paneEl?: HTMLElement | null;
  /** 本文枠の padding。用紙のときだけ、この分だけ外枠を外へ広げて机を本文枠いっぱいにする */
  bleed?: PaperBleed;
  /** 流れる本文のとき、中央カラムの上限（最大幅 828px）を外して幅いっぱいにする */
  fullWidth?: boolean;
};

// 本文の左右の溝（note-app の本文枠と app.css の .bn-editor が読む変数と同じ）。
// 流れる本文では変数を触らず、本文枠が渡した値（既定 54px・狭い枠では詰めた値）に任せる。
// 用紙では左 76px・右 約 35.4px（paper-layout.ts。見出しのハンドルまで用紙の内側に収める）に
// 上書きする。子要素（タイトル・文脈タグ）が同じ変数で左右の端を本文に揃える。
const GUTTER_VAR = "--gph-gutter-left" as const;
const GUTTER_RIGHT_VAR = "--gph-gutter-right" as const;
// 画像ブロックの高さの上限（app.css の :root の --graphium-image-max-h）。
// 用紙のときは印刷と同じ 150mm、ただし画面では標準の上限（app.css の
// --graphium-image-max-h-screen = 画面の高さの 60%）も超えない（短い画面で画像 1 枚が
// 収まらなくなるのを防ぐ）。印刷は #graphium-print-root が 150mm を自前で持つので画面の値は漏れない。
const IMAGE_MAX_H_VAR = "--graphium-image-max-h" as const;

export function PaperFrame({ mode, children, paneEl, bleed, fullWidth = false }: PaperFrameProps) {
  const t = useT();
  const embedded = paneEl !== undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  // 枠の幅。最初の描画の前に測る（測る前は流れる本文なので、紙が一瞬だけ流れて見えるのを防ぐ）
  const [frameWidth, setFrameWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = embedded ? paneEl : rootRef.current;
    if (!el) {
      setFrameWidth(null);
      return;
    }
    const measure = () => {
      // 縦スクロールバーを含む幅（offsetWidth）で測る。clientWidth だと、用紙にした途端に
      // スクロールバーが出て（用紙の高さ 297mm は本文枠より高い）幅が 15px 減り、
      // 境目の幅で「用紙 ⇄ 流れる本文」が行き来する（Windows の常時スクロールバー。
      // use-narrow-pane.ts と同じ理由）。
      // 0 は未計測と同じ扱い（ResizeObserver の無い環境・非表示の枠で「狭い」と誤判定しない）
      const w = Math.round(el.offsetWidth);
      const next = w > 0 ? w : null;
      setFrameWidth((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [embedded, paneEl]);

  // 狭いときの説明の吹き出し。マウス（少し遅らせて出す）・フォーカス・押して固定のどれかで見える
  const noticeRef = useRef<HTMLDivElement>(null);
  const [noticeHover, setNoticeHover] = useState(false);
  const [noticeFocus, setNoticeFocus] = useState(false);
  const [noticePinned, setNoticePinned] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);
  const noticeVisible = noticeHover || noticeFocus || noticePinned;
  const showHover = (on: boolean) => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    // 出すのは 100ms 遅らせる（通り過ぎでちらつかない）。消すのはすぐ
    if (on) hoverTimerRef.current = window.setTimeout(() => setNoticeHover(true), 100);
    else setNoticeHover(false);
  };
  useEffect(
    () => () => {
      if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    },
    [],
  );
  // 見えている間だけ Esc と外側のクリックで畳む
  useEffect(() => {
    if (!noticeVisible) return;
    const close = () => {
      setNoticeHover(false);
      setNoticeFocus(false);
      setNoticePinned(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: PointerEvent) => {
      if (noticeRef.current && !noticeRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [noticeVisible]);

  const layout = resolvePaperLayout(mode, frameWidth);
  const isSheet = layout === "sheet";
  const showNotice = shouldShowNarrowNotice(mode, layout, frameWidth);

  // 枠の幅・見た目が変わると本文の折り返しが変わる。本文に重ねて描く部品
  // （表のキャプション等）は window の resize・スクロール・エディタの DOM 変化でしか
  // 位置を測り直さないので、右パネルの開閉や見た目の切り替えでは古い位置に残る。
  // 描き終えたあとに resize を 1 回流して測り直させる。アプリでは、見た目（用紙 ⇄ 流れる本文）が
  // 変わったときだけ流す（標準のノートでは何も流さない。用紙の中は枠の幅が変わっても
  // 本文の幅が変わらないため、幅の変化ごとには要らない）。
  const lastLayoutRef = useRef<PaperLayout>("flow");
  useEffect(() => {
    if (frameWidth === null) return;
    if (embedded && lastLayoutRef.current === layout) return;
    lastLayoutRef.current = layout;
    const id = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return () => cancelAnimationFrame(id);
  }, [frameWidth, layout, embedded]);

  // 外枠の構造は layout が変わっても同じにする（エディタを作り直さないため、
  // 子の親要素を切り替えない。見た目だけをスタイルで変える）
  const rootStyle: CSSProperties = isSheet
    ? {
        // 机。紙より一段濃い --paper-3。色モード（高コントラスト・白い紙）でも
        // --paper / --paper-3 の差は保たれる
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        background: "var(--paper-3)",
        padding: `${DESK_MARGIN_BLOCK_PX}px ${DESK_MARGIN_PX}px`,
        // 本文枠の padding を打ち消して、机を本文枠いっぱいに広げる
        ...(embedded && bleed
          ? {
              marginTop: -bleed.top,
              marginRight: -bleed.right,
              marginBottom: -bleed.bottom,
              marginLeft: -bleed.left,
            }
          : { position: "relative" }),
      }
    : embedded
      ? {}
      : { padding: "16px 24px", position: "relative" };

  const pageStyle: VarStyle = isSheet
    ? {
        // 用紙。編集領域の背景（--color-background = --paper）と同じ色にして継ぎ目を出さない
        width: "210mm",
        minHeight: "297mm",
        flex: "none",
        background: "var(--paper)",
        border: "1px solid var(--rule)",
        boxShadow: "var(--shadow-2)",
        // 上下の余白 15mm。左右は本文（.bn-editor）とタイトルが持つ溝で取る（左 76px・右 約 35.4px）
        paddingBlock: "15mm",
        [GUTTER_VAR]: `${PAPER_GUTTER_LEFT_PX}px`,
        [GUTTER_RIGHT_VAR]: `${PAPER_GUTTER_RIGHT_PX}px`,
        [IMAGE_MAX_H_VAR]: "min(150mm, var(--graphium-image-max-h-screen))",
      }
    : fullWidth
      ? {}
      : { maxWidth: FLOW_MAX_WIDTH_PX, marginInline: "auto" };

  return (
    <div
      ref={rootRef}
      data-paper-mode={mode}
      data-paper-layout={layout}
      style={rootStyle}
    >
      <div
        // 用紙の印。ラベルのバッジ（prov-indicator）が用紙の右端を基準に置く
        {...(isSheet ? { [PAPER_SHEET_ATTR]: "" } : {})}
        style={showNotice ? { ...pageStyle, position: "relative" } : pageStyle}
      >
        {showNotice && (
          // 説明文は出さず、本文の右上に薄いアイコンだけ置く。説明はアプリで描く吹き出しで出す
          // （マウスを載せる・フォーカスする・押す）。ブラウザ標準の title は 1 秒ほど止めないと出ず、
          // 埋め込みのブラウザでは出ないこともあるため使わない。
          // 吹き出しはボタンの子にしない（アイコンの薄さが吹き出しに掛からないようにするため）。
          <div ref={noticeRef} className="absolute right-2 top-1 z-10">
            <button
              type="button"
              aria-label={t("paper.narrowNotice")}
              aria-expanded={noticeVisible}
              onMouseEnter={() => showHover(true)}
              onMouseLeave={() => showHover(false)}
              onFocus={() => setNoticeFocus(true)}
              onBlur={() => {
                setNoticeFocus(false);
                setNoticePinned(false);
              }}
              onClick={() => {
                // 押すと出たままにする（WebKit はボタンを押してもフォーカスが移らないため state で持つ）。
                // 固定中にもう一度押すと畳む
                if (noticePinned) {
                  setNoticePinned(false);
                  setNoticeHover(false);
                } else {
                  setNoticePinned(true);
                }
              }}
              className="flex h-6 w-6 cursor-help items-center justify-center rounded-md text-muted-foreground"
            >
              <FileX
                size={16}
                aria-hidden="true"
                className={noticeVisible ? "opacity-100" : "opacity-60"}
              />
            </button>
            <div
              aria-hidden="true"
              style={frameWidth !== null ? { maxWidth: Math.max(frameWidth - 24, 0) } : undefined}
              className={`absolute right-0 top-full mt-1 w-64 rounded-lg border border-border bg-card px-3 py-2 text-left text-xs text-foreground shadow-lg ${
                noticeVisible ? "visible" : "pointer-events-none invisible"
              }`}
            >
              {t("paper.narrowNotice")}
            </div>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
