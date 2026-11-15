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
  writeFileSync,
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

/** 移行が済んだ印（新 dataDir 直下）。あれば二度と旧 dataDir から複製しない */
const MIGRATION_DONE_MARKER = ".legacy-migrated";

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
  // 「無い」(ENOENT) と「読めない」(TCC 拒否など) は区別する。読めない回は印を書かず次回やり直す
  let legacyExists = true;
  try {
    statSync(legacyDir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") return result;
    legacyExists = false;
  }

  try {
    mkdirSync(newDataDir, { recursive: true });
  } catch (e) {
    result.errors.push({
      name: "(mkdir new dataDir)",
      reason: errorMessage(e),
    });
    return result;
  }

  // 済みの印があれば何もしない
  // （利用者が新側で消した・作り直した設定を、旧側から再度書き戻さない）
  if (existsSync(join(newDataDir, MIGRATION_DONE_MARKER))) {
    result.skipped.push(...MIGRATION_TARGETS);
    return result;
  }

  // 旧側が最初から無い起動も「済み」にする。あとで旧側に models.json が置かれても
  // （同期フォルダ・ZIP 展開など）新規の利用者へ複製しない
  if (!legacyExists) {
    writeDoneMarker(newDataDir);
    result.skipped.push(...MIGRATION_TARGETS);
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
      // 新側に既にあるものは上書きしない（models.json は apiBase を含むので特に）
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

  // エラーなく一巡したときだけ印を書く（TCC 拒否などで失敗した回は次回やり直す）
  if (result.errors.length === 0) {
    writeDoneMarker(newDataDir);
  }

  return result;
}

function writeDoneMarker(newDataDir: string): void {
  try {
    writeFileSync(join(newDataDir, MIGRATION_DONE_MARKER), new Date().toISOString());
  } catch {
    // 印が書けなくても起動は続ける
  }
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
