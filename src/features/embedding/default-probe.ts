// 埋め込みの既定を「このパソコンで」にしてよいかの下調べ
//
// 設定が空のとき、デスクトップでは端末内の bge-m3 を既定にする。ただし、これまで API で
// 埋め込んできた人（IndexedDB に API 製のベクトルが残っている）は黙って切り替えない。
// その判断に要る「API 製のベクトルがあるか」は IndexedDB を読まないと分からず非同期なので、
// 起動時（と設定画面を開いたとき）に読んでここに置き、同期の呼び出し側が参照する。
// 読めるまでは「ある」（= 従来どおり API）に倒す。読む前に端末内へ回してモデルの取得を
// 始めてしまわないため

import { embeddingStore } from "../../lib/embedding-store";
import { LOCAL_EMBEDDING_PREFIX } from "./engine";

let apiVectorsPresent: boolean | null = null;

/** 版ごとの件数から「API 製のベクトルがあるか」を決める純関数 */
export function versionsImplyApiUse(counts: ReadonlyMap<string, number>): boolean {
  for (const [version, n] of counts) {
    if (n <= 0) continue;
    if (!version || version === "text-only") continue;
    if (version.startsWith(LOCAL_EMBEDDING_PREFIX)) continue;
    return true;
  }
  return false;
}

/** API 製のベクトルが残っているか。未調査なら true（従来どおり API に倒す） */
export function hasApiVectors(): boolean {
  return apiVectorsPresent ?? true;
}

/** IndexedDB を読み直す。起動時・設定画面を開いたとき・作り直しのあとに呼ぶ */
export async function refreshEmbeddingDefaultProbe(): Promise<boolean> {
  try {
    apiVectorsPresent = versionsImplyApiUse(await embeddingStore.listModelVersions());
  } catch {
    // 読めなければ従来どおり（API）に倒す
    apiVectorsPresent = true;
  }
  return apiVectorsPresent;
}

/** テスト用 */
export function setApiVectorsPresentForTest(value: boolean | null): void {
  apiVectorsPresent = value;
}
