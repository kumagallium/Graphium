// fork 元の「基準版」の控え（変更の提案 §25 の 3 者比較の土台）。
//
// 何のためにあるか:
//   共有ノートを fork した時点の本文を手元に残しておくと、あとで
//   「変更の提案」を出すときに base（fork した版）/ mine（元の現在版）/
//   theirs（提案）の 3 者で比べられる。控えが無いと 2 者比較に落ち、
//   「提案者が変えた」のか「元の作者が変えた」のかが分けられない。
//
// 守っていること:
//   - 手元だけ。共有フォルダには一切書かない（appData のみ）
//   - 本文は読んだ文字列をそのまま持つ。JSON を作り直さない —— 提案時に
//     この文字列を content-addressed な blob に置くので、同じ基準版から出た
//     複数の提案が 1 個の blob に畳まれる（作り直すとバイト列が揺れて畳まれない）
//   - 読めない・書けないは失敗にしない。控えが無ければ base 無しの 2 者比較に落ちるだけ
//
// 設計詳細: docs/internal/team-shared-storage-design.md §25 / docs/DATA_MODEL.md §7.4

import { readAppDataFile, writeAppDataFile } from "../../lib/storage/app-data-file";
import type { StorageProvider } from "../../lib/storage/types";

/**
 * appData のキー。ノート 1 件につき 1 ファイル。
 *
 * 区切りに `:` を使わないのは Windows のファイル名に `:` が使えないため
 * （Tauri 側は key をそのままファイル名にする）。ノート id は UUID / Drive の
 * ファイル id なので、ファイル名に使えない文字は現れないが、万一混ざっても
 * 別のノートの控えを踏まないよう安全な文字だけに畳んでから使う。
 */
function appDataKey(noteId: string): string {
  return `fork-base-${sanitizeId(noteId)}`;
}

function driveFileName(noteId: string): string {
  return `.graphium-fork-base-${sanitizeId(noteId)}.json`;
}

function sanitizeId(noteId: string): string {
  return noteId.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** fork した時点の共有本文の控え。 */
export type ForkBase = {
  /** fork 元の共有エントリ id */
  sharedId: string;
  /** fork した時点の元エントリの hash（現在の版と一致するかの判定に使う） */
  hash: string;
  /** 読んだ共有本文（GraphiumDocument JSON）そのまま */
  body: string;
  /** 控えを取った時刻（ISO-8601） */
  savedAt: string;
};

function isForkBase(value: unknown): value is ForkBase {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ForkBase>;
  return (
    typeof v.sharedId === "string" &&
    typeof v.hash === "string" &&
    typeof v.body === "string" &&
    v.body.length > 0
  );
}

/**
 * fork で作った新しいノートの基準版を控える。
 * 書けなくても呼び出し側を止めない（fork そのものは成立している）。
 */
export async function saveForkBase(
  noteId: string,
  base: { sharedId: string; hash: string; body: string },
  provider?: StorageProvider,
): Promise<void> {
  if (!noteId) return;
  const value: ForkBase = {
    sharedId: base.sharedId,
    hash: base.hash,
    body: base.body,
    savedAt: new Date().toISOString(),
  };
  try {
    await writeAppDataFile(appDataKey(noteId), driveFileName(noteId), value, provider);
  } catch {
    // 控えが無ければ 2 者比較に落ちるだけ。fork を失敗させない
  }
}

/**
 * 控えを片付ける（§25b C-3）。
 *
 * いつ呼ぶか: 提案を取り下げた／提案が取り込まれた／派生したノートを消したとき。
 * 控えは「これから提案を出すため」だけの材料なので、その予定が無くなったら
 * 手元に残す理由が無い（ノート 1 件ぶんの本文をずっと抱えることになる）。
 *
 * 消す代わりに空の値を書くのは、app-data の口に削除が無いため。読み側
 * （loadForkBase）は形が合わない値を null として扱うので、結果は同じ。
 */
export async function clearForkBase(
  noteId: string,
  provider?: StorageProvider,
): Promise<void> {
  if (!noteId) return;
  try {
    await writeAppDataFile(
      appDataKey(noteId),
      driveFileName(noteId),
      { cleared: true, clearedAt: new Date().toISOString() },
      provider,
    );
  } catch {
    // 片付けられなくても害は無い（次の提案で古い基準版が使われるだけ）
  }
}

/** 控えを読む。無い / 壊れている場合は null（base 無しの 2 者比較に落ちる）。 */
export async function loadForkBase(
  noteId: string,
  provider?: StorageProvider,
): Promise<ForkBase | null> {
  if (!noteId) return null;
  try {
    const stored = await readAppDataFile<unknown>(
      appDataKey(noteId),
      driveFileName(noteId),
      provider,
    );
    return isForkBase(stored) ? stored : null;
  } catch {
    return null;
  }
}
