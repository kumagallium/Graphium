// サイドピークの保存を、ノートごとに 1 本の列に並べる。
//
// ピークはアンマウントの瞬間に未保存の編集を書き出す（閉じるボタンと同じ扱い）。書き出しは
// 非同期なので、同じノートをすぐ開き直したピーク（素材ギャラリーで素材を切り替えると全画面ごと
// 作り直す）は、保存が終わる前の doc キャッシュから開き、初期化で走る自動保存で古い本文を
// 書き戻してしまう。そこで:
//   - 同じノートの保存は、先の保存（成否を問わず）が終わってから書く（追い越さない）
//   - 列に保存が残っている間は、最後の保存の結果（書いた doc と成否）を取り出せる。
//     開く側（ピーク・チャットの書き戻し）はそれを待ってから最新の doc を読む
//
// メインエディタで同じノートを開くときも同じ問題が起きる（開いた直後の自動保存が古い本文を
// 書き戻す）。メイン側はピークがまだ開いているうちに開き始めることがあるので、下の
// 「開いているピーク」の口で未保存を書き出させてから列を待つ（flushPeekSaves）。
//
// キーはピークの noteId そのまま（wiki:/skill: 付き。doc キャッシュのキーと同じ形）。
// メインエディタの保存はこの列に並ばない。

import type { GraphiumDocument } from "./document-types";

export type PeekSaveOutcome = {
  /** 書いた（失敗なら書こうとした）doc */
  doc: GraphiumDocument;
  /** 保存に成功したか。失敗なら doc はどこにも書かれていない */
  saved: boolean;
};

const tails = new Map<string, Promise<PeekSaveOutcome>>();

// 書き出しに失敗し、まだ誰も引き取っていない doc（どこにも保存されていない編集）。
// メインエディタが開くときに引き取り、「未保存」から始めて自分の自動保存で書き直す。
// 同じノートの後の保存が成功したら消す（その保存の方が新しい。開いたままのピークなら
// 同じ編集も含んで書いている）
const unsavedDocs = new Map<string, GraphiumDocument>();

/**
 * 同じノートの先の保存が終わってから write を実行する。
 * 戻り値は write の結果（失敗なら reject する。呼び出し側が「未保存」に戻す）。
 */
export function queuePeekSave(
  noteId: string,
  doc: GraphiumDocument,
  write: () => Promise<void>,
): Promise<void> {
  const prev = tails.get(noteId);
  // prev（列の末尾）は reject しない
  const run = prev ? prev.then(() => write()) : write();
  const tail = run.then(
    (): PeekSaveOutcome => {
      unsavedDocs.delete(noteId);
      return { doc, saved: true };
    },
    (): PeekSaveOutcome => {
      unsavedDocs.set(noteId, doc);
      return { doc, saved: false };
    },
  );
  tails.set(noteId, tail);
  void tail.then(() => {
    // 後から並んだ保存があれば、列はそちらが持つ
    if (tails.get(noteId) === tail) tails.delete(noteId);
  });
  return run;
}

/**
 * このノートの保存が列に残っていれば、最後の保存が終わったときにその結果で解決する Promise。
 * 残っていなければ null（待たずに開いてよい）。
 */
export function pendingPeekSave(noteId: string): Promise<PeekSaveOutcome> | null {
  return tails.get(noteId) ?? null;
}

// ── 開いているピークの「未保存を今すぐ書き出す」口 ──
//
// ピークは最後の入力から 3 秒待って自動保存する。メインエディタが同じノートを開くとき、
// ピークはまだ画面にあることがある（本文のピークで開いているノートをサイドバーで押す・
// 一覧のピークで開いているノートの行をダブルクリックする）。ピークのアンマウント時の書き出しは
// メインが doc を決めた後になるので、開く側がこの口で先に書き出させる。
// ピークはノートを開いている間だけ登録する（SidePeek のレイアウト段階の effect）。

export type LivePeek = {
  /** 保存にまだ渡していない編集があるか */
  hasUnsaved: () => boolean;
  /** 未保存の編集を今すぐ保存の列に渡す（自動保存のタイマーは止める） */
  flush: () => void;
};

const livePeeks = new Map<string, Set<LivePeek>>();

/** 開いているピークを登録する。戻り値で登録を外す */
export function registerLivePeek(noteId: string, peek: LivePeek): () => void {
  let peeks = livePeeks.get(noteId);
  if (!peeks) livePeeks.set(noteId, (peeks = new Set()));
  peeks.add(peek);
  return () => {
    const current = livePeeks.get(noteId);
    if (!current) return;
    current.delete(peek);
    if (current.size === 0) livePeeks.delete(noteId);
  };
}

/**
 * このノートに、開いているピークの未保存の編集か、列に残った保存があるか。
 * 読むだけなので描画中に呼んでよい。
 */
export function hasPendingPeekEdits(noteId: string): boolean {
  if (tails.has(noteId)) return true;
  for (const peek of livePeeks.get(noteId) ?? []) {
    if (peek.hasUnsaved()) return true;
  }
  return false;
}

function flushLivePeeks(noteId: string): Promise<PeekSaveOutcome> | null {
  for (const peek of livePeeks.get(noteId) ?? []) {
    if (peek.hasUnsaved()) peek.flush();
  }
  return pendingPeekSave(noteId);
}

/**
 * 開いているピークに未保存の編集を書き出させ、このノートの保存が列から無くなるまで待つ。
 * 待つものが無ければ null（呼び出し側は同期のまま進めてよい）。
 * 解決値は最後の保存の結果。書き終えた doc は保存の onSaved が親のキャッシュに載せている。
 */
export function flushPeekSaves(noteId: string): Promise<PeekSaveOutcome> | null {
  const first = flushLivePeeks(noteId);
  if (!first) return null;
  return (async () => {
    let outcome = await first;
    // 待つ間に次の保存が並ぶことがある（まだ開いているピークに打たれた・ピークが閉じて書き出した）
    for (let next = flushLivePeeks(noteId); next; next = flushLivePeeks(noteId)) {
      outcome = await next;
    }
    return outcome;
  })();
}

/** 書き出しに失敗し、まだ誰も引き取っていない doc。読むだけ */
export function unsavedPeekDoc(noteId: string): GraphiumDocument | null {
  return unsavedDocs.get(noteId) ?? null;
}

/** doc を引き取ったら消す（別の失敗で差し替わっていれば残す） */
export function releaseUnsavedPeekDoc(noteId: string, doc: GraphiumDocument): void {
  if (unsavedDocs.get(noteId) === doc) unsavedDocs.delete(noteId);
}
