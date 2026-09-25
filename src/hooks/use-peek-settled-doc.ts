// メインエディタで開くノートの doc を、サイドピークの書き出しが済んでから決める。
//
// ピークで編集した直後（最後の入力から 3 秒以内・書き込み中）に同じノートをメインで開くと、
// メインは書き出し前の doc（activeDoc）からエディタを作る。ピークの書き出しはその後で
// 終わるが、エディタは作ったときの本文を持ち続けるので拾えない。メインは開いた直後にも
// 自動保存する（ラベル等の復元が変更扱いになる）ので、何も打たなくても古い本文で
// ピークの編集を書き戻す。
//
// 開く操作（use-file-manager の handleOpen*）は、ピークがまだ開いているうちに書き出させて
// 待つ。ここはそれを通らない入口の受け皿 — 素材ギャラリーや一覧を閉じて本文へ戻ると、
// メインのエディタのマウントとピークのアンマウント（書き出し）が同じコミットで起きる。
//
// - マウントの時点で同じノートの未保存の編集・書き込み中の保存があれば waiting を返し、
//   書き終わるのを待つ。待つかどうかはマウント時に一度だけ決める（開いた後で本文のピークに
//   同じノートを開いても、エディタを外さない）
// - 書き終えた doc は、書き出しの onSaved（reindexNoteFromDoc）が initialDoc（activeDoc）に載せる
// - 書き出しに失敗していれば、その doc（どこにも保存されていない編集）で開き、startUnsaved を
//   立てる（メインの自動保存で書き直す）

import { useEffect, useRef, useState } from "react";
import type { GraphiumDocument } from "../lib/document-types";
import {
  flushPeekSaves,
  hasPendingPeekEdits,
  releaseUnsavedPeekDoc,
  unsavedPeekDoc,
} from "../lib/peek-save-queue";
import { isIncomingDocNewer } from "./doc-recency";

export type PeekSettledDoc =
  | { waiting: true }
  | {
      waiting: false;
      /** エディタを組み立てる doc */
      doc: GraphiumDocument | null;
      /** ピークが保存できなかった編集を持ち込んだ。「未保存」から始める */
      startUnsaved: boolean;
    };

/** ピークが保存できなかった doc のうち、initialDoc より新しいもの */
function newerUnsavedDoc(
  docKey: string | null,
  initialDoc: GraphiumDocument | null,
): GraphiumDocument | null {
  if (!docKey) return null;
  const unsaved = unsavedPeekDoc(docKey);
  return unsaved && isIncomingDocNewer(unsaved, initialDoc ?? undefined) ? unsaved : null;
}

/**
 * @param docKey 開くノートのキー（fm.activeFileId。wiki:/skill: 付き。新規ノートは null）
 * @param initialDoc 開く doc（fm.activeDoc）
 */
export function usePeekSettledDoc(
  docKey: string | null,
  initialDoc: GraphiumDocument | null,
): PeekSettledDoc {
  const initialDocRef = useRef(initialDoc);
  initialDocRef.current = initialDoc;
  const [waiting, setWaiting] = useState(() => docKey !== null && hasPendingPeekEdits(docKey));
  // 引き取った「ピークが保存できなかった doc」。開く時点（待ったなら待ち終わり）で一度だけ決める
  const [unsavedDoc, setUnsavedDoc] = useState<GraphiumDocument | null>(() =>
    waiting ? null : newerUnsavedDoc(docKey, initialDoc),
  );

  useEffect(() => {
    if (!waiting || !docKey) return;
    let cancelled = false;
    void (async () => {
      // 閉じたピークはアンマウント時に書き出して列に並べている。まだ開いているピークには
      // ここで書き出させる
      await flushPeekSaves(docKey);
      if (cancelled) return;
      setUnsavedDoc(newerUnsavedDoc(docKey, initialDocRef.current));
      setWaiting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [docKey, waiting]);

  // 引き取った doc は lib から外す（以後はメインのエディタが持ち、自分の保存で書く）
  useEffect(() => {
    if (docKey && unsavedDoc) releaseUnsavedPeekDoc(docKey, unsavedDoc);
  }, [docKey, unsavedDoc]);

  if (waiting) return { waiting: true };
  // 引き取った doc を使うのは、initialDoc がそれより新しくなるまで — メインの保存や
  // 外からの書き換え（チャットの書き戻し等）で進んだ activeDoc を隠さない
  const doc =
    unsavedDoc && isIncomingDocNewer(unsavedDoc, initialDoc ?? undefined) ? unsavedDoc : initialDoc;
  return { waiting: false, doc, startUnsaved: unsavedDoc !== null };
}
