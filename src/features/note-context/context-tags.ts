// ユーザーが手で付ける「文脈ラベル」（noteContexts）の正規化・集計ユーティリティ。
//
// 文脈ラベルは PROV ブロックラベル（procedure/material/…, features/context-label/）とは
// 別軸の概念。混同を避けるため features/note-context/ に分離している。
// - source of truth: GraphiumDocument.noteContexts（ノート直下・配列・複数可）
// - index mirror: NoteIndexEntry.noteContexts（buildIndexEntry で normalize してから流す）
//
// 表記揺れ（"eureco" / "Eureco"）は「小文字比較で名寄せ・表示は初出の形」で吸収する。
// 正規化キーを別途永続化はしない（1 つ以上のノートが持つ値だけが実体化する設計）。

/**
 * 文脈ラベル配列を正規化する。
 * - 文字列以外を除去
 * - trim + 空文字除去
 * - 小文字比較で重複除去（表示は初出の形を保持）
 * - 1 つも残らなければ undefined（「未分類」）
 */
export function normalizeNoteContexts(
  input: readonly unknown[] | undefined | null,
): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result.length > 0 ? result : undefined;
}

/**
 * 既存ノートの文脈ラベルを集計し、サジェスト候補（値 + 件数）を返す。
 * 小文字比較で名寄せし、表示名は最頻出の表記を採用する。件数降順 → 名前昇順でソート。
 */
export function aggregateNoteContexts(
  entries: readonly { noteContexts?: string[] }[],
): { value: string; count: number }[] {
  // key(小文字) → { displayCounts: 表記別出現数, total: 名寄せ後の合計 }
  const buckets = new Map<string, { displayCounts: Map<string, number>; total: number }>();
  for (const entry of entries) {
    const contexts = normalizeNoteContexts(entry.noteContexts);
    if (!contexts) continue;
    for (const value of contexts) {
      const key = value.toLowerCase();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { displayCounts: new Map(), total: 0 };
        buckets.set(key, bucket);
      }
      bucket.total += 1;
      bucket.displayCounts.set(value, (bucket.displayCounts.get(value) ?? 0) + 1);
    }
  }
  const result: { value: string; count: number }[] = [];
  for (const bucket of buckets.values()) {
    // 最頻出の表記を代表表示名にする
    let display = "";
    let best = -1;
    for (const [value, count] of bucket.displayCounts) {
      if (count > best) {
        best = count;
        display = value;
      }
    }
    result.push({ value: display, count: bucket.total });
  }
  result.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "ja"));
  return result;
}

/**
 * ノートに文脈ラベルを 1 つ追加した結果を返す（イミュータブル）。
 * 既に（小文字比較で）存在する場合はそのまま返す。正規化も同時に行う。
 */
export function addNoteContext(
  current: readonly string[] | undefined,
  value: string,
): string[] | undefined {
  return normalizeNoteContexts([...(current ?? []), value]);
}

/**
 * ノートから文脈ラベルを 1 つ除去した結果を返す（イミュータブル・小文字比較）。
 * 空になったら undefined を返す。
 */
export function removeNoteContext(
  current: readonly string[] | undefined,
  value: string,
): string[] | undefined {
  const key = value.trim().toLowerCase();
  return normalizeNoteContexts((current ?? []).filter((c) => c.trim().toLowerCase() !== key));
}

/**
 * 文脈名から安定した色を決める（名前ハッシュ）。PROV ラベル（LABEL_HEX）とは別パレット。
 * ユーザーが色を選ぶ概念は v1 では出さない（段階的開示）。HSL で彩度・明度を固定し
 * 色相だけ名前から決めることで、design.md のトーン（淡い background + 濃いテキスト）に収める。
 */
export function noteContextHue(value: string): number {
  let hash = 0;
  const key = value.trim().toLowerCase();
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) % 360;
  }
  return hash;
}
