// チャットの書き換えの道具（ブラウザで実行する。サーバーの代理は client-tool-bridge.ts）
//   read_for_edit: 対象のノート・スキルを、ブロックの番号（b1 …）付きで読む
//   propose_edit:  変更を修正案として出す。その場では書き換えない（回答の下のカードで利用者が反映する）
// 番号は read_for_edit で読んだ時点のブロックに振る。propose_edit はその時点の本文を before に控え、
// 反映するときに今の本文と照らす（edit-ops.ts）。

import type { ChatEditChange, ChatEditProposal } from "../../../lib/document-types";
import { getEditFileHost, readTargetBlocks, type EditTarget } from "./controller";
import { formatBlocksForAi, listBlocksForEdit, markdownToNewBlocks, type BlockForEdit } from "./edit-ops";

export const READ_FOR_EDIT_TOOL = "read_for_edit";
export const PROPOSE_EDIT_TOOL = "propose_edit";
export const EDIT_TOOL_NAMES = [READ_FOR_EDIT_TOOL, PROPOSE_EDIT_TOOL] as const;

/** 1 回の提案で出せる変更の上限（カードが読み切れる量に抑える） */
const MAX_CHANGES = 20;
/** 1 つの変更の本文の上限 */
const MAX_TEXT_CHARS = 4000;

export type EditToolSession = {
  toolNames: string[];
  execute(name: string, input: Record<string, unknown>): Promise<string>;
  /** この回答で出した修正案（対象ごとに 1 件） */
  proposals(): ChatEditProposal[];
};

type ReadState = { target: EditTarget; blocks: Map<string, BlockForEdit> };

const keyOf = (t: EditTarget) => `${t.kind}:${t.id}`;

export function createEditToolSession(opts: {
  currentNoteId?: string | null;
  /** フォルダで範囲を絞った会話では、読める・直せるノートも同じ範囲に閉じる（検索の道具と同じ柵） */
  onlyIds?: ReadonlySet<string>;
}): EditToolSession {
  const reads = new Map<string, ReadState>();
  const proposals = new Map<string, ChatEditProposal>();

  const resolve = (ref: unknown): EditTarget | string => {
    const host = getEditFileHost();
    if (!host) return "Error: editing is not available right now.";
    const text = typeof ref === "string" ? ref.trim() : "";
    if (!text) return "Error: target is required.";
    const r = host.resolveTarget(text.slice(0, 300), { currentNoteId: opts.currentNoteId, onlyIds: opts.onlyIds });
    if ("error" in r) return `Error: ${r.error}`;
    return r;
  };

  const readForEdit = async (input: Record<string, unknown>): Promise<string> => {
    const target = resolve(input.target);
    if (typeof target === "string") return target;
    const blocks = await readTargetBlocks(target);
    if (!blocks) return `Error: could not read "${target.title}".`;
    // スキルの先頭の区切りの見出し（Prompt Template）は本文ではないので出さない
    const skip = new Set<string>();
    if (target.kind === "skill" && blocks[0]?.type === "heading") skip.add(blocks[0].id);
    const list = listBlocksForEdit(blocks, skip);
    reads.set(keyOf(target), { target, blocks: new Map(list.map((b) => [b.handle, b])) });
    const kind = target.kind === "skill" ? "Skill" : "Note";
    const body = list.length > 0 ? formatBlocksForAi(list) : "(no blocks)";
    return `${kind} "${target.title}" — blocks for editing:\n${body}`;
  };

  const proposeEdit = async (input: Record<string, unknown>): Promise<string> => {
    const target = resolve(input.target);
    if (typeof target === "string") return target;
    const state = reads.get(keyOf(target));
    if (!state) return `Error: call ${READ_FOR_EDIT_TOOL} for "${target.title}" first.`;
    const raw = Array.isArray(input.changes) ? input.changes : [];
    if (raw.length === 0) return "Error: changes is required.";
    if (raw.length > MAX_CHANGES) return `Error: at most ${MAX_CHANGES} changes per call.`;

    const changes: ChatEditChange[] = [];
    const problems: string[] = [];
    for (const [i, c] of raw.entries()) {
      const item = (c ?? {}) as Record<string, unknown>;
      const op = item.op === "replace" || item.op === "insert_after" || item.op === "delete" ? item.op : null;
      const handle = typeof item.block === "string" ? item.block.trim().replace(/^\[|\]$/g, "") : "";
      const block = state.blocks.get(handle);
      const text = typeof item.text === "string" ? item.text.slice(0, MAX_TEXT_CHARS) : "";
      if (!op) {
        problems.push(`#${i + 1}: op must be replace, insert_after, or delete`);
        continue;
      }
      if (!block) {
        problems.push(`#${i + 1}: unknown block "${handle}"`);
        continue;
      }
      if ((op === "replace" || op === "delete") && !block.rewritable) {
        problems.push(`#${i + 1}: ${handle} is read-only (links, mentions, math, or a non-text block such as a table or image); it cannot be rewritten or deleted, but you can add a new block after it`);
        continue;
      }
      if (op === "delete" && block.hasChildren) {
        problems.push(`#${i + 1}: ${handle} has child blocks and cannot be deleted`);
        continue;
      }
      if (op !== "delete" && markdownToNewBlocks(text).length === 0) {
        problems.push(`#${i + 1}: text is required for ${op}`);
        continue;
      }
      changes.push({
        id: crypto.randomUUID(),
        op: op === "insert_after" ? "insert" : op,
        blockId: block.id,
        before: block.markdown,
        ...(op !== "delete" ? { after: text.trim() } : {}),
      });
    }
    if (changes.length === 0) return `Error: no valid changes. ${problems.join("; ")}`;

    const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
    const prev = proposals.get(keyOf(target));
    proposals.set(keyOf(target), {
      id: prev?.id ?? crypto.randomUUID(),
      target,
      ...(reason || prev?.reason ? { reason: reason || prev?.reason } : {}),
      changes: [...(prev?.changes ?? []), ...changes],
    });
    const skipped = problems.length > 0 ? ` Skipped: ${problems.join("; ")}.` : "";
    return (
      `Proposed ${changes.length} change(s) to "${target.title}". Nothing has been changed yet: ` +
      `the user sees them as cards under your answer and chooses whether to apply each one.${skipped}`
    );
  };

  return {
    toolNames: [...EDIT_TOOL_NAMES],
    async execute(name, input) {
      try {
        if (name === READ_FOR_EDIT_TOOL) return await readForEdit(input);
        if (name === PROPOSE_EDIT_TOOL) return await proposeEdit(input);
        return `Error: unknown tool ${name}.`;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    proposals() {
      return [...proposals.values()].map((p) => ({ ...p, changes: [...p.changes] }));
    },
  };
}

/** 複数の道具のまとまりを 1 つにする（名前で振り分ける） */
export function combineClientTools(
  ...sessions: ({ toolNames: string[]; execute(name: string, input: Record<string, unknown>): Promise<string> } | null | undefined)[]
): { names: string[]; execute: (name: string, input: Record<string, unknown>) => Promise<string> } {
  const live = sessions.filter((s): s is NonNullable<typeof s> => !!s);
  return {
    names: live.flatMap((s) => s.toolNames),
    execute: (name, input) => {
      const owner = live.find((s) => s.toolNames.includes(name));
      return owner ? owner.execute(name, input) : Promise.resolve(`Error: unknown tool ${name}.`);
    },
  };
}
