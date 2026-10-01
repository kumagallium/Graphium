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

/**
 * 本文の幅を doc に書く 2 項目にする（buildDocument が使う）。
 * 標準は両方 undefined（fullWidth: false を書かない）。保存の組み立てで
 * 項目を書き忘れると保存のたびに落ちるので、書く側はこの関数の戻り値を spread する。
 */
export function bodyWidthToDocFields(width: BodyWidth): {
  fullWidth: boolean | undefined;
  paperSize: PaperSize | undefined;
} {
  return { fullWidth: width.fullWidth || undefined, paperSize: width.paperSize };
}

/**
 * 「最後に保存先にあった形」を作る前に、読み込んだ doc の本文の幅の 2 項目を
 * 保存する形（bodyWidthToDocFields(resolveBodyWidth(doc))）へ揃える。
 * 揃えないと、両方が立った doc・知らない paperSize・fullWidth: false の明示保存を開いただけで、
 * buildDocument の出力と比較用の形が食い違い、「変わった」と判定されて書き込みまで進む
 * （no-write-on-open）。正規化した形は、利用者が次に何かを編集して保存したときに書かれる。
 * なお知らない paperSize（将来の版が書いた値）は、その次の保存で落ちる（標準の表示に戻る）。
 */
export function withNormalizedBodyWidth<T extends { fullWidth?: boolean; paperSize?: unknown }>(
  doc: T,
): T {
  return { ...doc, ...bodyWidthToDocFields(resolveBodyWidth(doc)) };
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
 * 白紙から作る新しいノートの本文の幅。個人の設定「新しいノートを A4 の幅で始める」が
 * ON なら A4、そうでなければ標準。
 *
 * 呼ぶのは「白紙から作る」入口だけ（サイドバーの ＋ ノート・フォルダ内の新規ノート・
 * 空のエディタ）。テンプレート・取り込み・AI・MCP・共有の fork・派生は呼ばない
 * （派生は buildDerivedDocument が元のノートの幅を引き継ぐ）。
 */
export function newNoteBodyWidth(startOnA4: boolean): BodyWidth {
  return startOnA4 ? { fullWidth: false, paperSize: "a4" } : STANDARD_BODY_WIDTH;
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
