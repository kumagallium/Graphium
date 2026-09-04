// Graphium ネイティブ捕獲ファイル（メモ / URL）の形式定義。
//
// モバイルの [書く] / [URL] で作った捕獲物を、写真と同じ送信キュー → Inbox 経路で
// デスクトップへ運ぶための **バージョン付き JSON**。ビルド（モバイル側）とパース
// （デスクトップ importer 側）を同じモジュールに置き、形式のドリフトを防ぐ。
//
// 設計判断（ユーザー決定・docs/internal/mobile-capture-transport-design-2026-07.md §13.6）:
// - .md ではなく **ネイティブ JSON**。デスクトップ側で「本物のメモ / URL 素材」として
//   着地させるには構造化データが要る（.md だと再パースで意味が失われる）。
// - 拡張子は誤爆しない専用形 `.graphium.json`。ユーザーが手で置いた無関係な .json を
//   乗っ取らないため、デスクトップの判定は **拡張子 + JSON 形状の両方**（parse 参照）。
// - 未知バージョン / 形状不正は null を返し、呼び出し側（importer）が従来どおり
//   「その他」素材として取り込む — **データを落とさない**。

/** 捕獲ファイルの形式バージョン。互換を壊す変更で上げる（旧デスクトップは素材扱いに退避）。 */
export const GRAPHIUM_CAPTURE_FILE_VERSION = 1 as const;

/** 専用拡張子。`.json` 単体にしないのは、無関係な JSON との誤爆を防ぐため。 */
export const GRAPHIUM_CAPTURE_EXTENSION = ".graphium.json";

/** 捕獲ファイルの MIME。File.type / キューの mime / Drive アップロードの Content-Type に使う。 */
export const GRAPHIUM_CAPTURE_MIME = "application/vnd.graphium.capture+json";

/** メモ捕獲のペイロード。 */
export type GraphiumMemoCapturePayload = {
  graphium: typeof GRAPHIUM_CAPTURE_FILE_VERSION;
  kind: "memo";
  /** モバイルで書いた時刻（ISO8601）。デスクトップのメモ createdAt に引き継ぐ。 */
  createdAt: string;
  text: string;
};

/** URL 捕獲のペイロード。メタデータはモバイル側で取得済みのものを運ぶ（デスクトップは再取得しない）。 */
export type GraphiumUrlCapturePayload = {
  graphium: typeof GRAPHIUM_CAPTURE_FILE_VERSION;
  kind: "url";
  createdAt: string;
  url: string;
  title?: string;
  description?: string;
  ogImage?: string;
  /**
   * 送信時に指定されたフォルダ。取り込み時に素材の noteContexts へ入る。
   * メディアは名前に埋め込むが（push/naming.ts）、URL は元から JSON なのでここに置く。
   */
  folder?: string;
};

export type GraphiumCapturePayload = GraphiumMemoCapturePayload | GraphiumUrlCapturePayload;
export type GraphiumCaptureKind = GraphiumCapturePayload["kind"];

/** 名前が捕獲ファイルの専用拡張子を持つか（大文字小文字は無視）。 */
export function isGraphiumCaptureName(name: string): boolean {
  return name.toLowerCase().endsWith(GRAPHIUM_CAPTURE_EXTENSION);
}

/**
 * 正規化済みファイル名から kind を推定する（`...-memo.graphium.json` / `...-url.graphium.json`）。
 * 中身を読まずにアイコンを出したい一覧（送信キュー行・受信箱行）用。確定情報は
 * parse したペイロードの kind が正（名前はあくまで表示のヒント）。
 */
export function captureKindFromName(name: string): GraphiumCaptureKind | null {
  if (!isGraphiumCaptureName(name)) return null;
  const stem = name.slice(0, name.length - GRAPHIUM_CAPTURE_EXTENSION.length).toLowerCase();
  if (stem === "memo" || stem.endsWith("-memo")) return "memo";
  if (stem === "url" || stem.endsWith("-url")) return "url";
  return null;
}

function toCaptureFile(kind: GraphiumCaptureKind, payload: GraphiumCapturePayload): File {
  // 元名は `<kind>.graphium.json`。キュー投入時に push/naming.ts が
  // `graphium-<YYYYMMDD-HHmmss>-<連番>-<kind>.graphium.json` へ正規化する。
  return new File([JSON.stringify(payload, null, 2)], `${kind}${GRAPHIUM_CAPTURE_EXTENSION}`, {
    type: GRAPHIUM_CAPTURE_MIME,
  });
}

/** メモ捕獲ファイルを作る（モバイルの [書く] → キュー）。 */
export function buildMemoCaptureFile(text: string, now: Date = new Date()): File {
  const payload: GraphiumMemoCapturePayload = {
    graphium: GRAPHIUM_CAPTURE_FILE_VERSION,
    kind: "memo",
    createdAt: now.toISOString(),
    text,
  };
  return toCaptureFile("memo", payload);
}

/** URL 捕獲ファイルを作る（モバイルの [URL] → キュー）。メタはあるものだけ運ぶ。 */
export function buildUrlCaptureFile(
  input: { url: string; title?: string; description?: string; ogImage?: string; folder?: string },
  now: Date = new Date(),
): File {
  const title = input.title?.trim();
  const description = input.description?.trim();
  const payload: GraphiumUrlCapturePayload = {
    graphium: GRAPHIUM_CAPTURE_FILE_VERSION,
    kind: "url",
    createdAt: now.toISOString(),
    url: input.url,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(input.ogImage ? { ogImage: input.ogImage } : {}),
    ...(input.folder?.trim() ? { folder: input.folder.trim() } : {}),
  };
  return toCaptureFile("url", payload);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 捕獲ファイルをパースする。**拡張子 + JSON 形状の両方**で判定し、
 * どちらかを満たさなければ null（呼び出し側は従来の素材取り込みへフォールバック）。
 *
 * null になるもの: 専用拡張子でない / JSON でない / graphium バージョン不一致
 * （未知の新バージョン含む）/ kind 不明 / 必須フィールド（memo.text, url.url）欠落。
 * createdAt は無くても弾かない（着地側が取り込み時刻で補う — データ優先）。
 */
export function parseGraphiumCaptureFile(
  name: string,
  jsonText: string,
): GraphiumCapturePayload | null {
  if (!isGraphiumCaptureName(name)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.graphium !== GRAPHIUM_CAPTURE_FILE_VERSION) return null;
  const createdAt = isNonEmptyString(obj.createdAt) ? obj.createdAt : new Date().toISOString();

  if (obj.kind === "memo") {
    if (!isNonEmptyString(obj.text)) return null;
    return { graphium: GRAPHIUM_CAPTURE_FILE_VERSION, kind: "memo", createdAt, text: obj.text };
  }
  if (obj.kind === "url") {
    if (!isNonEmptyString(obj.url)) return null;
    return {
      graphium: GRAPHIUM_CAPTURE_FILE_VERSION,
      kind: "url",
      createdAt,
      url: obj.url,
      ...(isNonEmptyString(obj.title) ? { title: obj.title } : {}),
      ...(isNonEmptyString(obj.description) ? { description: obj.description } : {}),
      ...(isNonEmptyString(obj.ogImage) ? { ogImage: obj.ogImage } : {}),
    };
  }
  return null;
}

/**
 * 一覧行の 1 行プレビュー。memo は本文の最初の非空行、url はタイトル（無ければ URL）。
 * 送信キュー行（モバイル）と受信箱行（デスクトップ）で共用する。
 */
export function captureFilePreview(payload: GraphiumCapturePayload): string {
  if (payload.kind === "memo") {
    const firstLine = payload.text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return firstLine ?? "";
  }
  return payload.title ?? payload.url;
}
