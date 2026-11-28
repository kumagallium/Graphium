// ナレッジページ（トピック・要約・知見など）の本文の引用を、番号（[1]）で見せる。
//
// 本文の引用は保存上「@資料の題」の青い文字（＋リンク記録）で、文ごとに付く。題が長い
// 資料（チャットの質問文が題になったもの等）を引くと、同じ段落に長い題が何度も並んで
// 読みにくい。そこで、ページ末尾の References の並び順で番号を振り、本文では題を隠して
// 番号だけを見せる。References の各行の頭にも同じ番号を出し、本文の [n] と突き合わせられる
// ようにする。
//
// - 文書は書き換えない（ProseMirror の decoration で見た目だけ変える）。保存・書き出し・
//   コピー・AI に渡す本文は今までどおり「@題」のまま。既存のページにもそのまま効く
// - クリックは今までどおり効く（隠した文字の span の中に番号を出すので、
//   mention-click の readMentionAt が同じ青文字の @題 を読む）
// - 題は title 属性に入れ、マウスを乗せると見える
// - 見た目を変えるのは、エディタの入れ物に data-numbered-citations が付いているとき
//   だけ（ナレッジページを開いたときに付ける）。普通のノートの文書には効かない
// - References に無い資料の引用（番号を決められないもの）は「@題」のまま残す
// - 引用の直後の灰色の注記「（AI が写した一節が資料に見つからない）」は、番号にした引用では
//   隠して番号に「*」を付け、References の下に注釈を 1 行だけ置く（文ごとに長い注記が並ぶと
//   本文が読めないため）。注記を探すのは UNVERIFIED_PASSAGE_NOTE の文字（保存時と同じ組）

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { createExtension } from "@blocknote/core";
import { Extension as TiptapExtension } from "@tiptap/core";
import { UNVERIFIED_PASSAGE_FOOTNOTE, UNVERIFIED_PASSAGE_NOTE } from "../../lib/source-citations";

export const citationNumberPluginKey = new PluginKey<DecorationSet>("citationNumbers");

/** buildTopicReferenceBlocks（wiki-service.ts）が出す References 見出しの文字 */
const REFERENCES_HEADING = "References";

/** 青い @メンションの文字の塊（同じ textblock 内で続く青文字の text ノードを 1 つにまとめたもの） */
type MentionRun = { from: number; to: number; title: string; nodes: { from: number; to: number }[] };

/** 引用の直後に置かれた注記（灰色の文字の中の、注記の文字の範囲）。lang は注記の言語 */
type NoteSpan = { from: number; to: number; lang: string };

function hasTextColor(node: PMNode, color: string): boolean {
  return node.marks.some((m) => m.type.name === "textColor" && m.attrs.stringValue === color);
}

function isBlueText(node: PMNode): boolean {
  return hasTextColor(node, "blue");
}

/** textblock の中の灰色の注記（資料に見つからなかった一節）を取り出す */
function collectNoteSpans(block: PMNode, blockPos: number): NoteSpan[] {
  const spans: NoteSpan[] = [];
  block.forEach((child, offset) => {
    if (!child.isText || !hasTextColor(child, "gray")) return;
    const text = child.text ?? "";
    const from = blockPos + 1 + offset;
    for (const [lang, note] of Object.entries(UNVERIFIED_PASSAGE_NOTE)) {
      let i = text.indexOf(note);
      while (i >= 0) {
        spans.push({ from: from + i, to: from + i + note.length, lang });
        i = text.indexOf(note, i + note.length);
      }
    }
  });
  return spans.sort((a, b) => a.from - b.from);
}

/** textblock の中の青い @メンションを取り出す */
function collectMentionRuns(block: PMNode, blockPos: number): MentionRun[] {
  const runs: MentionRun[] = [];
  let current: { from: number; to: number; text: string; nodes: { from: number; to: number }[] } | null = null;
  const flush = () => {
    if (current) {
      const text = current.text.trim();
      // 見出しへの参照（@#）は引用ではない
      if (text.startsWith("@") && !text.startsWith("@#") && text.length > 1) {
        runs.push({ from: current.from, to: current.to, title: text.slice(1), nodes: current.nodes });
      }
    }
    current = null;
  };
  block.forEach((child, offset) => {
    const from = blockPos + 1 + offset;
    const to = from + child.nodeSize;
    if (child.isText && isBlueText(child)) {
      if (current && current.to === from) {
        current.to = to;
        current.text += child.text ?? "";
        current.nodes.push({ from, to });
      } else {
        flush();
        current = { from, to, text: child.text ?? "", nodes: [{ from, to }] };
      }
    } else {
      flush();
    }
  });
  flush();
  return runs;
}

/** 文書の decoration を組み立てる（純関数。テストから呼ぶ） */
export function buildCitationNumberDecorations(doc: PMNode): DecorationSet {
  // 1) 見出し・textblock を文書順に並べる
  type Item =
    | { kind: "heading"; level: number; text: string }
    | { kind: "text"; runs: MentionRun[]; notes: NoteSpan[]; end: number };
  const items: Item[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === "heading") {
      items.push({ kind: "heading", level: Number(node.attrs.level) || 1, text: node.textContent.trim() });
    } else {
      // end = textblock の中身の終わり（References の下の注釈を置く位置に使う）
      items.push({
        kind: "text",
        runs: collectMentionRuns(node, pos),
        notes: collectNoteSpans(node, pos),
        end: pos + node.nodeSize - 1,
      });
    }
    return false;
  });

  // 2) References の範囲（見出しの次から、同じか上のレベルの見出しの手前まで）
  const refIndex = items.findIndex((it) => it.kind === "heading" && it.text === REFERENCES_HEADING);
  if (refIndex < 0) return DecorationSet.empty;
  const refLevel = (items[refIndex] as { level: number }).level;
  let refEnd = items.length;
  for (let i = refIndex + 1; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "heading" && it.level <= refLevel) {
      refEnd = i;
      break;
    }
  }

  // 3) References の並び順で番号を振る（同じ題が 2 度出たら最初の番号）
  const numbers = new Map<string, number>();
  const decorations: Decoration[] = [];
  for (let i = refIndex + 1; i < refEnd; i++) {
    const it = items[i];
    if (it.kind !== "text") continue;
    for (const run of it.runs) {
      if (numbers.has(run.title)) continue;
      const n = numbers.size + 1;
      numbers.set(run.title, n);
      decorations.push(
        Decoration.widget(
          run.from,
          () => {
            const el = document.createElement("span");
            el.className = "gm-cite-ref-num";
            el.textContent = `[${n}]`;
            return el;
          },
          { side: -1, key: `cite-ref-${n}`, ignoreSelection: true },
        ),
      );
    }
  }
  if (numbers.size === 0) return DecorationSet.empty;

  // 4) 本文（References の外）の引用を番号にする。直後に注記が付いた引用は「*」を付けて注記を隠す
  let footnoteLang: string | null = null;
  items.forEach((it, i) => {
    if (it.kind !== "text" || (i > refIndex && i < refEnd)) return;
    for (const run of it.runs) {
      const n = numbers.get(run.title);
      if (n === undefined) continue;
      // 注記は引用のすぐ後ろ（間に空白だけ）に置かれる
      const note = it.notes.find(
        (s) => s.from >= run.to && doc.textBetween(run.to, s.from).trim() === "",
      );
      if (note) {
        footnoteLang ??= note.lang;
        decorations.push(Decoration.inline(note.from, note.to, { class: "gm-cite-note" }));
      }
      run.nodes.forEach((node, k) => {
        const last = k === run.nodes.length - 1;
        decorations.push(
          Decoration.inline(node.from, node.to, {
            class: last ? "gm-cite-num" : "gm-cite-num gm-cite-num-part",
            "data-cite-num": note ? `${n}*` : String(n),
            title: note ? `${run.title}\n${UNVERIFIED_PASSAGE_FOOTNOTE[note.lang].slice(2)}` : run.title,
          }),
        );
      });
    }
  });

  // 5) 「*」を付けた引用があれば、References の最後の行の下に注釈を 1 行置く
  if (footnoteLang) {
    const lastRef = items.slice(refIndex + 1, refEnd).reverse().find((it) => it.kind === "text");
    if (lastRef && lastRef.kind === "text") {
      const text = UNVERIFIED_PASSAGE_FOOTNOTE[footnoteLang];
      decorations.push(
        Decoration.widget(
          lastRef.end,
          () => {
            const el = document.createElement("span");
            el.className = "gm-cite-footnote";
            el.contentEditable = "false";
            el.textContent = text;
            return el;
          },
          { side: 1, key: `cite-footnote-${footnoteLang}`, ignoreSelection: true },
        ),
      );
    }
  }

  return DecorationSet.create(doc, decorations);
}

function createCitationNumberPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: citationNumberPluginKey,
    state: {
      init: (_config, state) => buildCitationNumberDecorations(state.doc),
      apply: (tr, old, _oldState, newState) =>
        tr.docChanged ? buildCitationNumberDecorations(newState.doc) : old,
    },
    props: {
      decorations(state) {
        return citationNumberPluginKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}

/** BlockNote の editor 生成時に `extensions` へ渡す拡張（documentSearchExtension と同じ形） */
export const citationNumberExtension = createExtension({
  key: "citation-numbers",
  tiptapExtensions: [
    TiptapExtension.create({
      name: "citationNumbers",
      addProseMirrorPlugins() {
        return [createCitationNumberPlugin()];
      },
    }),
  ],
});
