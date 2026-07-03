// エクスポート用ファイル名ヘルパ（純ロジック）
// タイトルの sanitize と、zip 内エントリ名の同名衝突 dedupe を担う。
// PDF / PROV-JSON-LD エクスポートと同じ禁止文字セットを踏襲する。

/** ファイル名に使えない文字（既存の PDF / JSON-LD エクスポートと同じセット） */
const FORBIDDEN_CHARS = /[/\\?%*:|"<>]/g;

/**
 * タイトルをファイル名として安全な文字列に変換する。
 * - 禁止文字は "_" に置換
 * - 前後の空白・末尾のドットを除去（Windows でのファイル名制約対策）
 * - 先頭のドットを除去（隠しファイル化を防ぐ）
 * - 空になったら fallback を返す
 * - 長すぎるタイトルは 120 文字で切り詰める（zip 内パス長の暴走防止）
 */
export function sanitizeFilename(title: string, fallback = "Untitled"): string {
  const cleaned = title
    .replace(FORBIDDEN_CHARS, "_")
    // 制御文字（改行など）はスペースに落とす
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .slice(0, 120)
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * GraphiumFile.name からストレージ上の拡張子を取り除いてタイトル相当にする。
 * プロバイダによって name は `タイトル.graphium.json`（local）や
 * `uuid.json`（filesystem）なので、doc.title が空のときのフォールバック用。
 */
export function stripStorageExt(name: string): string {
  return name.replace(/\.graphium\.json$/i, "").replace(/\.json$/i, "");
}

/**
 * zip 内のエントリ名を決める。タイトル sanitize 済みの base 名が既に使われている
 * 場合は id サフィックスで dedupe し、それでも衝突するなら連番を付ける。
 *
 * @param items  ノートの id とタイトルの一覧（表示順のまま渡す）
 * @param ext    拡張子（"." 込み。例: ".md" / ".graphium.json"）
 * @returns      id → zip エントリ名 の Map（挿入順は items の順序を保つ）
 */
export function assignZipNames(
  items: { id: string; title: string }[],
  ext: string,
): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const item of items) {
    const base = sanitizeFilename(item.title);
    let name = `${base}${ext}`;
    if (used.has(name)) {
      // 同名衝突: id サフィックスで区別する
      const idSuffix = sanitizeFilename(item.id, "dup");
      name = `${base}-${idSuffix}${ext}`;
      // id まで同じことは無いはずだが、念のため連番で最終防衛する
      let counter = 2;
      while (used.has(name)) {
        name = `${base}-${idSuffix}-${counter}${ext}`;
        counter++;
      }
    }
    used.add(name);
    result.set(item.id, name);
  }
  return result;
}
