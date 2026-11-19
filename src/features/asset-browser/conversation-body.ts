// AI との会話の本文（renderConversationBody の出力）を、表示用の塊に分ける純関数。
// 文字は 1 字も変えない（2 字下げを外すだけ）。Markdown としては解釈しない。

export type ConversationBlock =
  | { kind: "lead"; text: string }
  | { kind: "date"; text: string }
  | { kind: "turn"; side: "ai" | "me"; label: string; body: string };

/** 行頭 `- ` のあと、最初の半角 `: `（コロン＋空白）までを見出し、後ろを中身とする */
function splitTurn(first: string): { label: string; body: string } {
  const rest = first.slice(2);
  const i = rest.indexOf(": ");
  if (i < 0) return { label: "", body: rest };
  return { label: rest.slice(0, i), body: rest.slice(i + 2) };
}

/** 見出しが AI で始まれば AI の行。そうでなければ（壊れた形も）本人の側 */
function sideOf(label: string): "ai" | "me" {
  return label.startsWith("AI") ? "ai" : "me";
}

/** 本文を 1 回なめて塊に分ける（線形） */
export function parseConversationBody(text: string): ConversationBlock[] {
  const lines = text.split("\n");
  const blocks: ConversationBlock[] = [];
  const lead: string[] = [];
  let seenDate = false;
  // 組み立て中の発言
  let turn: { side: "ai" | "me"; label: string; lines: string[]; pendingBlank: number } | null = null;

  const flushTurn = () => {
    if (!turn) return;
    blocks.push({ kind: "turn", side: turn.side, label: turn.label, body: turn.lines.join("\n") });
    turn = null;
  };
  const flushLead = () => {
    // 冒頭の説明の前後の空行は落とす（中の改行はそのまま）。
    // 正規表現（\n+$）は、途中に長い空行の並びがあると 2 乗の時間になるので、行の配列の端から数える
    let from = 0;
    let to = lead.length;
    while (from < to && lead[from] === "") from += 1;
    while (to > from && lead[to - 1] === "") to -= 1;
    const t = lead.slice(from, to).join("\n");
    if (t) blocks.push({ kind: "lead", text: t });
    lead.length = 0;
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (!seenDate) flushLead();
      flushTurn();
      seenDate = true;
      blocks.push({ kind: "date", text: line.slice(3) });
      continue;
    }
    if (line.startsWith("- ")) {
      if (!seenDate) flushLead();
      flushTurn();
      seenDate = true;
      const { label, body } = splitTurn(line);
      turn = { side: sideOf(label), label, lines: [body], pendingBlank: 0 };
      continue;
    }
    if (turn) {
      if (line === "") {
        // 空行は、あとに続きの行が来たときだけ発言の中に含める
        turn.pendingBlank++;
        continue;
      }
      if (line.startsWith("  ")) {
        for (; turn.pendingBlank > 0; turn.pendingBlank--) turn.lines.push("");
        turn.lines.push(line.slice(2));
        continue;
      }
      // 字下げの無い行は発言の外
      flushTurn();
    }
    if (!seenDate) {
      lead.push(line);
    } else if (line !== "") {
      // 日付のあとの、どれにも当てはまらない行は本人の側の行として残す（落とさない）
      blocks.push({ kind: "turn", side: "me", label: "", body: line });
    }
  }
  flushTurn();
  if (!seenDate) flushLead();
  return blocks;
}
