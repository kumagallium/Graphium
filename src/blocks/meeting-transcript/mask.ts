// 音声ノートのブロックの「名前などを伏せる」（純ロジック）
//
// 伏せるにしたブロックは、ノートに書き出せるものを「伏せて作った清書・要約」だけにする。
// 文字起こし（原本）と、伏せる前に作った清書・要約は書き出さない。ノートを読む AI
// （ナレッジ化・チャット・タイトル付けなど）にはノートの本文しか渡らないので、伏せた文だけが渡る。

import type { CleanupDoc, SummaryDoc } from "../../features/meeting-recorder/artifacts";
import { maskText, type MaskLanguage } from "../../lib/meeting-mask";

/** 書き出せないときの理由 */
export type WriteOutBlock = "none" | "notMasked" | "masking";

export type WriteOutState = {
  summary: WriteOutBlock | null;
  cleanup: WriteOutBlock | null;
  transcript: WriteOutBlock | null;
  /** ファイルに保存（書き出せるものを 1 つのファイルにまとめる）。どれも書き出せなければ "none" */
  file: WriteOutBlock | null;
};

/** 書き出しメニューの各項目が選べるか（null = 選べる）と、選べない理由 */
export function writeOutState(mask: boolean, cleanup: CleanupDoc | null, summary: SummaryDoc | null): WriteOutState {
  const of = (doc: CleanupDoc | SummaryDoc | null): WriteOutBlock | null =>
    !doc ? "none" : mask && !doc.masked ? "notMasked" : null;
  const summaryState = of(summary);
  const cleanupState = of(cleanup);
  const transcriptState = mask ? "masking" : null;
  return {
    summary: summaryState,
    cleanup: cleanupState,
    transcript: transcriptState,
    file: summaryState === null || cleanupState === null || transcriptState === null ? null : "none",
  };
}

/**
 * 書き出す直前に、その時点の「必ず伏せる語」とメール・電話番号の形でもう一度伏せる。
 * 清書・要約を作ったあとで語を足しても、書き出す文には効く
 */
export function remaskCleanup(doc: CleanupDoc, terms: string[], language: MaskLanguage): CleanupDoc {
  return { ...doc, paragraphs: doc.paragraphs.map((p) => ({ ...p, text: maskText(p.text, terms, language) })) };
}

export function remaskSummary(doc: SummaryDoc, terms: string[], language: MaskLanguage): SummaryDoc {
  const m = (s: string) => maskText(s, terms, language);
  return {
    ...doc,
    decisions: doc.decisions.map((x) => ({ ...x, text: m(x.text) })),
    todos: doc.todos.map((x) => ({
      ...x,
      text: m(x.text),
      ...(x.owner ? { owner: m(x.owner) } : {}),
      ...(x.due ? { due: m(x.due) } : {}),
    })),
    issues: doc.issues.map((x) => ({ ...x, text: m(x.text) })),
  };
}
