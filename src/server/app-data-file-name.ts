// appData のキー ⇄ ファイル名。Rust（src-tauri/src/lib.rs の app_data_file_name）と同じ規則。
// `:` を含むファイル名は Windows で代替データストリーム（ADS）になり、OneDrive・zip・
// exFAT・一部の NAS へのコピーで抜け落ちる。そのため `%` → `%25`、`:` → `%3A` に置き換える
// （この順で。単射）。

/** キー → ファイル名（拡張子 .json 付き） */
export function appDataFileName(key: string): string {
  return `${key.replace(/%/g, "%25").replace(/:/g, "%3A")}.json`;
}

/** ファイル名（拡張子なし）→ キー。appDataFileName の逆変換 */
export function appDataKeyFromFileName(stem: string): string {
  return stem.replace(/%(3A|25)/g, (_, c: string) => (c === "3A" ? ":" : "%"));
}

/** 旧来の名前 `<key>.json`（符号化前）。`:` か `%` を含むキーだけが旧名を持ち得る */
export function legacyAppDataFileName(key: string): string | null {
  return key.includes(":") || key.includes("%") ? `${key}.json` : null;
}
