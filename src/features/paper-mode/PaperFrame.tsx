// A4 の用紙の幅で書く表示（試作）— 本文の外枠
//
// standard: 今の流れる本文（最大幅 828px の中央カラム）。
// a4: 机の色の上に用紙（幅 210mm・余白 15mm・薄い影と罫線・最小の高さ 297mm）を置き、
//     本文の幅を印刷と同じ 180mm にする。改ページはしない（流れる本文のまま）。
//
// 枠が「用紙 + 左右の机」より狭いときは紙の見た目をやめて流れる本文に戻し、上部に
// 注意書きを出す。縮めて見せる（transform: scale / CSS zoom）ことはしない
// （本文に重ねて描く部品の位置がずれる。画面の拡大縮小を WebView のズームに
// 切り替えたのと同じ理由）。
//
// 試作なのでアプリ（note-app）には組み込まない。モードは呼び出し側（ストーリー）が渡す。

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useT } from "../../i18n";
import {
  FLOW_GUTTER_PX,
  FLOW_MAX_WIDTH_PX,
  resolvePaperLayout,
  shouldShowNarrowNotice,
  type PaperMode,
} from "./paper-layout";
import "./paper-frame.css";

// CSS カスタムプロパティ（--*）を含む style
type VarStyle = CSSProperties & Record<`--${string}`, string>;

export type PaperFrameProps = {
  mode: PaperMode;
  /** タイトル・文脈タグ・エディタ。タイトル等の左右は var(--graphium-page-gutter) に揃える */
  children: ReactNode;
};

// 用紙の中ではこの溝が 15mm、流れる本文では 54px（.bn-editor の padding-inline と同じ）になる。
// 子要素（タイトル・文脈タグ）が同じ変数で左端を本文に揃える。
const GUTTER_VAR = "--graphium-page-gutter" as const;
// 画像ブロックの高さの上限（別ブランチ feat/image-max-height で入れる変数）。
// 用紙のときは印刷と同じ 150mm。main にまだ無い間は効かないが害は無い。
const IMAGE_MAX_H_VAR = "--graphium-image-max-h" as const;

export function PaperFrame({ mode, children }: PaperFrameProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  // 枠の幅。最初の描画の前に測る（測る前は流れる本文なので、紙が一瞬だけ流れて見えるのを防ぐ）
  const [frameWidth, setFrameWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      setFrameWidth((prev) => (prev === w ? prev : w));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = resolvePaperLayout(mode, frameWidth);
  const isSheet = layout === "sheet";

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
        padding: "24px",
        position: "relative",
      }
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
          // 上下の余白 15mm。左右は本文（.bn-editor）とタイトルが持つ溝で取る
          paddingBlock: "15mm",
          [GUTTER_VAR]: "15mm",
          [IMAGE_MAX_H_VAR]: "150mm",
        }
      : {
          width: "100%",
          maxWidth: FLOW_MAX_WIDTH_PX,
          marginInline: "auto",
          [GUTTER_VAR]: `${FLOW_GUTTER_PX}px`,
      };

  return (
    <div
      ref={rootRef}
      data-paper-mode={mode}
      data-paper-layout={layout}
      style={rootStyle}
    >
      {shouldShowNarrowNotice(mode, layout) && (
        <p
          role="note"
          className="mx-auto mb-3 text-xs text-muted-foreground"
          style={{ maxWidth: FLOW_MAX_WIDTH_PX, paddingInline: FLOW_GUTTER_PX }}
        >
          {t("paper.narrowNotice")}
        </p>
      )}
      <div style={pageStyle}>{children}</div>
    </div>
  );
}
