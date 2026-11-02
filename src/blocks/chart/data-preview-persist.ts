// データ素材の下見の保存（media-text チャネル）
//
// 下見（列名・行数・線の形）は素材の本文から計算する。素材の実体は fileId に対して
// 不変なので、一度計算した結果は保存して使い回してよい。保存しておけば、アプリを
// 起動し直しても一覧を開いた時点で線が出る（本文の読み込みと計算を待たない）。
//
// - 置き場は media-text チャネルの `datapreview_<fileId>`（URL ブックマークの
//   プレビュー画像と同じ。素材の一覧には混ざらず、3 プロバイダとも実装済み）
// - 計算方法（間引きの区間数・重ねる本数・列の判定）を変えたら PREVIEW_FORMAT を上げる。
//   版の違う保存は読み捨てて計算し直し、上書きする
// - 保存も読み出しも失敗は無視する（保存できなければ毎回計算するだけ）

import { getActiveProvider } from "../../lib/storage/registry";
import { dataPreviewKey } from "../../features/asset-browser/media-index";
import type { DataPreview, SparkPoint, SparkSeries } from "./data-preview";

/** 保存形式の版。計算方法を変えたら上げる */
export const PREVIEW_FORMAT = 1;

type Stored = { format: number; preview: DataPreview };

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");

const isPoint = (v: unknown): v is SparkPoint =>
  typeof v === "object" &&
  v !== null &&
  Number.isFinite((v as SparkPoint).x) &&
  Number.isFinite((v as SparkPoint).y);

const isSeries = (v: unknown): v is SparkSeries =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as SparkSeries).column === "string" &&
  Array.isArray((v as SparkSeries).points) &&
  (v as SparkSeries).points.every(isPoint);

/** 保存した JSON を読む。版が違う・形が崩れているものは null（計算し直す） */
export function parseStoredPreview(text: string | undefined): DataPreview | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { format, preview } = raw as Partial<Stored>;
  if (format !== PREVIEW_FORMAT || typeof preview !== "object" || preview === null) return null;
  const p = preview as DataPreview;
  if (
    !isStringArray(p.headers) ||
    !Number.isInteger(p.rowCount) ||
    p.rowCount < 0 ||
    !isStringArray(p.numericColumns) ||
    !Array.isArray(p.sparkline) ||
    !p.sparkline.every(isSeries) ||
    typeof p.usable !== "boolean"
  ) {
    return null;
  }
  return {
    headers: p.headers,
    rowCount: p.rowCount,
    numericColumns: p.numericColumns,
    sparkline: p.sparkline,
    usable: p.usable,
  };
}

/** 保存する JSON。点の座標は描画に足りる桁に丸めて小さくする */
export function serializePreview(preview: DataPreview): string {
  const round = (n: number) => Number(n.toPrecision(6));
  const stored: Stored = {
    format: PREVIEW_FORMAT,
    preview: {
      ...preview,
      sparkline: preview.sparkline.map((s) => ({
        column: s.column,
        points: s.points.map((pt) => ({ x: round(pt.x), y: round(pt.y) })),
      })),
    },
  };
  return JSON.stringify(stored);
}

/** 保存済みの下見を読む。無い・読めない・版が違うときは null */
export async function loadSavedPreview(fileId: string): Promise<DataPreview | null> {
  const key = dataPreviewKey(fileId);
  const provider = getActiveProvider();
  if (!key || !provider.loadMediaText) return null;
  try {
    return parseStoredPreview(await provider.loadMediaText(key));
  } catch {
    return null;
  }
}

/** 下見を保存する（失敗は無視） */
export async function savePreview(fileId: string, preview: DataPreview): Promise<void> {
  const key = dataPreviewKey(fileId);
  const provider = getActiveProvider();
  if (!key || !provider.saveMediaText) return;
  try {
    await provider.saveMediaText(key, serializePreview(preview));
  } catch {
    // 保存できなければ次回も計算するだけ
  }
}

/** 素材を削除したときに下見も消す（失敗は無視。残っても数 KB の孤児） */
export async function deleteSavedPreview(fileId: string): Promise<void> {
  const key = dataPreviewKey(fileId);
  const provider = getActiveProvider();
  if (!key || !provider.deleteMediaText) return;
  try {
    await provider.deleteMediaText(key);
  } catch {
    /* best-effort */
  }
}
