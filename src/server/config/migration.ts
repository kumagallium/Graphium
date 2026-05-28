// 旧 dataDir (~/Documents/Graphium/server-data) から新 dataDir への一回限り
// のデータ移行。
//
// なぜ必要か:
//   macOS Sequoia の TCC (Transparency, Consent, and Control) で、Tauri
//   経由で spawn された sidecar (node) が ~/Documents 配下を読めないケース
//   がある。Documents は TCC 保護対象で、署名が変わった瞬間に過去の許可が
//   無効化される。Application Support 配下は TCC 保護外なので、そこを
//   恒久的な保存場所にする。既存ユーザーの models.json / profiles.json /
//   usage ログを取りこぼさないため、起動時に一度だけ copy する。
//
// 設計方針:
//   - 旧 → 新 の copy 専用。旧 path は残す（rollback と人手復元のため）。
//   - 新 path に同名のものがあれば skip（ユーザーが既に新環境で書いている）。
//   - 旧 path が読めない（TCC 拒否 / ENOENT）→ silent skip。sidecar の起動は
//     続行する。

import {
  existsSync,
  readdirSync,
  copyFileSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** 旧 dataDir（v0.12.0 まではここに保存していた） */
export const LEGACY_DATA_DIR = join(
  homedir(),
  "Documents",
  "Graphium",
  "server-data",
);

/** テスト用に LEGACY_DATA_DIR の代わりを差し込めるよう、関数の第二引数で
 *  legacy path を override できるようにしている。本番呼び出しは省略する。 */

/** トップレベルで移行する対象 */
const MIGRATION_TARGETS = ["models.json", "profiles.json", "usage"] as const;

export type MigrationResult = {
  /** copy が成功した item 名 */
  copied: string[];
  /** 元になかった、または新側に既にあった item 名 */
  skipped: string[];
  /** copy 中に発生したエラー */
  errors: Array<{ name: string; reason: string }>;
};

/**
 * 旧 dataDir から新 dataDir に対象ファイルを copy する。
 *
 * 冪等で、複数回呼んでも壊れない。新 path に既にファイルがあれば常に skip。
 */
export function migrateLegacyDataDir(
  newDataDir: string,
  legacyDir: string = LEGACY_DATA_DIR,
): MigrationResult {
  const result: MigrationResult = { copied: [], skipped: [], errors: [] };

  if (legacyDir === newDataDir) return result;

  // 旧 path の存在確認自体が TCC で落ちることがあるので try で囲む
  let legacyExists = false;
  try {
    legacyExists = existsSync(legacyDir);
  } catch {
    return result;
  }
  if (!legacyExists) return result;

  try {
    mkdirSync(newDataDir, { recursive: true });
  } catch (e) {
    result.errors.push({
      name: "(mkdir new dataDir)",
      reason: errorMessage(e),
    });
    return result;
  }

  for (const name of MIGRATION_TARGETS) {
    const src = join(legacyDir, name);
    const dst = join(newDataDir, name);
    try {
      if (!existsSync(src)) {
        result.skipped.push(name);
        continue;
      }
      if (existsSync(dst)) {
        result.skipped.push(name);
        continue;
      }
      const stat = statSync(src);
      if (stat.isDirectory()) {
        copyDirRecursive(src, dst);
      } else {
        copyFileSync(src, dst);
      }
      result.copied.push(name);
    } catch (e) {
      result.errors.push({ name, reason: errorMessage(e) });
    }
  }

  return result;
}

function copyDirRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const sp = join(src, entry);
    const dp = join(dst, entry);
    const stat = statSync(sp);
    if (stat.isDirectory()) {
      copyDirRecursive(sp, dp);
    } else {
      copyFileSync(sp, dp);
    }
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
