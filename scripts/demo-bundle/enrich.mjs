/**
 * 取り込み直後のノート（DATA_DIR/notes/*.json）に、Markdown では書けない 2 つを足す。
 *
 *   1. 派生リンク: Markdown の [[リンク]] は取り込みで「参照（reference）」の knowledgeLink に
 *      なるが、系譜（PROV の wasDerivedFrom）は doc.noteLinks の derived_from しか読まない。
 *      @ で入れたときと同じ形（mention-insert.ts の appendDerivedFromLink と同じ）で
 *      noteLinks に写す。同じ相手への線は 1 本だけ
 *   2. 工程ブロック: steps.<locale>.json の指定どおり、見出しの前に「工程」見出しと step ブロックを
 *      差し込む。材料・パラメータ・出力の span は inline-label のスタイル
 *      （inlineMaterial / inlineAttribute / inlineOutput）で付け、PROV の工程グラフに乗せる
 *
 * 使い方:
 *   node scripts/demo-bundle/enrich.mjs --data-dir <DATA_DIR> --steps scripts/demo-bundle/steps.ja.json
 *
 * ナレッジ化の前に実行する（ナレッジ化はノート本文を読むので、工程の文もナレッジに入る）。
 */
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : def;
};
const DATA_DIR = resolve(opt("data-dir", process.env.DATA_DIR ?? ""));
const STEPS = opt("steps", "");
const notesDir = resolve(DATA_DIR, "notes");

const STYLE_KEY = { material: "inlineMaterial", tool: "inlineTool", output: "inlineOutput", attribute: "inlineAttribute" };
const entityId = (kind) => `ent_${kind}_${Math.random().toString(36).slice(2, 10)}`;

function makeStepBlock(step) {
  const children = step.lines.map((line) => ({
    id: randomUUID(),
    type: "paragraph",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
    content: line.map((span) => {
      if (!span.k) return { type: "text", text: span.t, styles: {} };
      const id = entityId(span.k);
      // パラメータは親の工程（Activity）に直結する印を付ける（step-io.ts と同じ）
      const value = span.k === "attribute" ? `${id}@activity` : id;
      return { type: "text", text: span.t, styles: { [STYLE_KEY[span.k]]: value } };
    }),
    children: [],
  }));
  return {
    id: randomUUID(),
    type: "step",
    props: { textAlignment: "left", variant: "step" },
    content: [{ type: "text", text: step.title, styles: {} }],
    children,
  };
}

function headingText(block) {
  if (block?.type !== "heading") return "";
  return (block.content ?? []).map((c) => c.text ?? "").join("").trim();
}

const stepsSpec = STEPS ? JSON.parse(readFileSync(resolve(STEPS), "utf8")) : null;
let linksAdded = 0;
let stepsAdded = 0;
for (const f of readdirSync(notesDir).filter((f) => f.endsWith(".json"))) {
  const path = resolve(notesDir, f);
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const page = doc.pages?.[0];
  if (!page) continue;
  let changed = false;

  // 1. reference → derived_from
  const refs = (page.knowledgeLinks ?? []).filter((l) => l.type === "reference" && l.targetNoteId);
  if (refs.length > 0) {
    const links = Array.isArray(doc.noteLinks) ? doc.noteLinks : [];
    for (const r of refs) {
      if (links.some((l) => l.targetNoteId === r.targetNoteId)) continue;
      links.push({ targetNoteId: r.targetNoteId, sourceBlockId: r.sourceBlockId, type: "derived_from" });
      linksAdded++;
      changed = true;
    }
    doc.noteLinks = links;
  }

  // 2. 工程ブロック
  const steps = stepsSpec?.notes?.[doc.title];
  if (steps && !page.blocks.some((b) => b.type === "step")) {
    const idx = page.blocks.findIndex((b) => headingText(b) === stepsSpec.beforeHeading);
    const insertAt = idx === -1 ? page.blocks.length : idx;
    const heading = {
      id: randomUUID(),
      type: "heading",
      props: { textColor: "default", backgroundColor: "default", textAlignment: "left", level: 2 },
      content: [{ type: "text", text: stepsSpec.heading, styles: {} }],
      children: [],
    };
    page.blocks.splice(insertAt, 0, heading, ...steps.map(makeStepBlock));
    stepsAdded += steps.length;
    changed = true;
  }

  if (changed) {
    doc.modifiedAt = new Date().toISOString();
    writeFileSync(path, JSON.stringify(doc, null, 2));
  }
}
console.log(`[enrich] derived_from links added=${linksAdded}, step blocks added=${stepsAdded}`);
