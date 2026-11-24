// この端末で利用者が確定した「リンクした素材からの取り込み」の控え。
//
// 表の出所（source.fileId）はノートに書かれるので、共有されたノートや改ざんで書き換わりうる。
// ノートが使っている素材（usedIn）の確認だけでは、改ざんしたノートを一度保存した後は通ってしまう。
// そこで「この端末で取り込みを確定した (fileId, placeId, relPath)」を端末の中だけ（localStorage）に控え、
// 再取り込みのとき、控えに無いファイルは読む前に利用者へ確かめる。ノートにも共有にも乗せない。

const STORAGE_KEY = "graphium:linked-import-ledger";
/** 控えの上限。超えたら古いものから捨てる */
export const LINKED_LEDGER_MAX = 500;

export type LinkedLedgerEntry = { fileId: string; placeId: string; relPath: string };

function isEntry(v: unknown): v is LinkedLedgerEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e.fileId === "string" && typeof e.placeId === "string" && typeof e.relPath === "string";
}

function sameEntry(a: LinkedLedgerEntry, b: LinkedLedgerEntry): boolean {
  return a.fileId === b.fileId && a.placeId === b.placeId && a.relPath === b.relPath;
}

/** 控えを読む。無い・壊れているときは空として扱う（投げない） */
export function readLinkedLedger(): LinkedLedgerEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).map((e) => ({ fileId: e.fileId, placeId: e.placeId, relPath: e.relPath }));
  } catch {
    return [];
  }
}

/** 控えへ足した新しい並び（純粋）。同じ組は末尾へ移し、上限を超えた古いものを捨てる */
export function addToLedger(list: LinkedLedgerEntry[], entry: LinkedLedgerEntry, max = LINKED_LEDGER_MAX): LinkedLedgerEntry[] {
  const next = list.filter((e) => !sameEntry(e, entry));
  next.push({ fileId: entry.fileId, placeId: entry.placeId, relPath: entry.relPath });
  return next.length > max ? next.slice(next.length - max) : next;
}

/** この組が控えにあるか（純粋） */
export function isInLedger(list: LinkedLedgerEntry[], entry: LinkedLedgerEntry): boolean {
  return list.some((e) => sameEntry(e, entry));
}

/** 取り込みを確定したときに控える。書けなくても取り込みは止めない */
export function recordLinkedImport(entry: LinkedLedgerEntry): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(addToLedger(readLinkedLedger(), entry)));
  } catch {
    // 書けない環境（容量・無効化）では控えないだけ。次の再取り込みで確かめが出る
  }
}

/** 再取り込みのとき、読む前に利用者へ確かめる必要があるか（控えに無いとき true） */
export function needsReadConfirm(entry: LinkedLedgerEntry, list: LinkedLedgerEntry[] = readLinkedLedger()): boolean {
  return !isInLedger(list, entry);
}
