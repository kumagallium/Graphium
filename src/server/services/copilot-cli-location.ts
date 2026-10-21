// Graphium が取得した Copilot CLI の置き場所（固定版・パス計算だけ）
//
// copilot-cli-manager（取得・ログイン）・cli-binary-resolver（解決）・
// copilot-subscription（起動 env）の 3 者が参照するため、循環 import を避けて
// 依存の無い小さなモジュールに分けている。

import { join, resolve, sep } from "node:path";
import { getDataDir } from "../config/models.js";

/** 取得する Copilot CLI の固定版（公式 GitHub Releases の v<版>） */
export const COPILOT_CLI_VERSION = "1.0.101";

/** 取得物をまとめて置くルート: <dataDir>/tools/copilot-cli */
export function managedCopilotCliRoot(): string {
  return join(getDataDir(), "tools", "copilot-cli");
}

/** 版ごとのディレクトリ */
export function managedCopilotCliDir(version: string = COPILOT_CLI_VERSION): string {
  return join(managedCopilotCliRoot(), version);
}

/** 実行ファイル名（Windows は .exe） */
export function copilotBinName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "copilot.exe" : "copilot";
}

/** 取得した CLI の実行ファイルのパス（存在するとは限らない） */
export function managedCopilotCliPath(
  version: string = COPILOT_CLI_VERSION,
  platform: NodeJS.Platform = process.platform,
): string {
  return join(managedCopilotCliDir(version), copilotBinName(platform));
}

/** パスが Graphium の取得した CLI の置き場所配下か */
export function isManagedCopilotCliPath(p: string): boolean {
  const root = resolve(managedCopilotCliRoot()) + sep;
  return resolve(p).startsWith(root);
}
