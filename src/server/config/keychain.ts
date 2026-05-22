// macOS Keychain ラッパー（API キー保存用）
//
// 設計判断:
//   - `security` CLI を `execFileSync` で叩く。native module (keytar 等) を避けて
//     esbuild バンドル時の煩雑さを回避する。macOS のみで使う。
//   - 同期 API にしているのは `listModels` 等の既存呼び出し（Hono ルートが多数）が
//     すべて同期前提で書かれているため。Keychain 呼び出しは数 ms オーダーなので、
//     既存設計に合わせて sync で実装する。
//   - argv 経由でキーを渡すことには `ps` で同一ユーザープロセスから一瞬見える
//     リスクがあるが、平文ファイルが Time Machine / iCloud / Spotlight に乗る方が
//     はるかに被害が大きい。ここでは Keychain 化を優先する。

import { execFileSync } from "node:child_process";

const SERVICE = "com.graphium.app";

/** Keychain 経由で API キーを扱うか */
export function isKeychainEnabled(): boolean {
  return (
    process.platform === "darwin" &&
    process.env.GRAPHIUM_USE_KEYCHAIN === "1"
  );
}

/** API キーを Keychain に書き込む（既存があれば上書き）。失敗時は例外。 */
export function setApiKey(modelId: string, apiKey: string): void {
  execFileSync(
    "security",
    ["add-generic-password", "-U", "-s", SERVICE, "-a", modelId, "-w", apiKey],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
}

/** Keychain から API キーを取得する。見つからなければ null。 */
export function getApiKey(modelId: string): string | null {
  try {
    const out = execFileSync(
      "security",
      ["find-generic-password", "-s", SERVICE, "-a", modelId, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out.replace(/\r?\n$/, "");
  } catch {
    return null;
  }
}

/** Keychain から削除する。存在しない場合も成功扱い。 */
export function deleteApiKey(modelId: string): void {
  try {
    execFileSync(
      "security",
      ["delete-generic-password", "-s", SERVICE, "-a", modelId],
      { stdio: "ignore" },
    );
  } catch {
    // 存在しない / 既に消えている場合は無視
  }
}
