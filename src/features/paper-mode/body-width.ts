// 本文の幅の選び方（⋯ メニューの「幅いっぱいに表示」と「A4 の幅で書く」）。
//
// この 2 つはどちらか一方だけ（片方を入れたらもう片方は外す）。保存する項目は
// doc.fullWidth と doc.paperSize の 2 つで、読み込み・切り替えの両方をここで通す
// （画面側で個別に組むと、両方が立った状態が保存に紛れ込む）。

import type { PaperSize } from "../../lib/document-types";

export type BodyWidth = {
  fullWidth: boolean;
  paperSize: PaperSize | undefined;
};

/** 標準（固定幅の中央カラム） */
export const STANDARD_BODY_WIDTH: BodyWidth = { fullWidth: false, paperSize: undefined };

/**
 * 保存された doc の項目から本文の幅を決める。値が無い・知らない値なら標準。
 * 両方が立っていた場合（古い版と新しい版を行き来した場合など）は A4 を優先する。
 */
export function resolveBodyWidth(doc: {
  fullWidth?: boolean;
  paperSize?: unknown;
} | null | undefined): BodyWidth {
  if (doc?.paperSize === "a4") return { fullWidth: false, paperSize: "a4" };
  return { fullWidth: doc?.fullWidth === true, paperSize: undefined };
}

/** 「幅いっぱいに表示」を選んだあと。入っていれば外し、入っていなければ入れて A4 を外す */
export function toggleFullWidthChoice(cur: BodyWidth): BodyWidth {
  return { fullWidth: !cur.fullWidth, paperSize: undefined };
}

/** 「A4 の幅で書く」を選んだあと。入っていれば外し、入っていなければ入れて幅いっぱいを外す */
export function toggleA4Choice(cur: BodyWidth): BodyWidth {
  return { fullWidth: false, paperSize: cur.paperSize === "a4" ? undefined : "a4" };
}

/**
 * 実際に用紙の表示にするか。モバイルは全幅の別の作り（ハンドルも無い）なので常に標準。
 * サイドピークは note-app の本文を使わないので、そもそもここを通らない。
 */
export function effectivePaperMode(
  paperSize: PaperSize | undefined,
  { isDesktop }: { isDesktop: boolean },
): "standard" | "a4" {
  return isDesktop && paperSize === "a4" ? "a4" : "standard";
}
