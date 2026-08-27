#!/usr/bin/env node
/**
 * MCP サーバーの E2E スモークテスト（自己完結・決定論的）
 *
 * シナリオ:
 *   一時 vault に fixture ノートを 2 件置く
 *   → MCP クライアントとして接続し、7 ツールが登録されていることを確認
 *   → search / get_note / get_note_steps / find_notes_using / list_entities / trace_lineage
 *   → create_note で 3 件目を書き、そのまま検索で引けることを確認
 *
 * 守っている不変条件:
 *   - **stdout を汚さない**: サーバーが JSON-RPC 以外を stdout に書くとハンドシェイクが壊れる。
 *     接続できた時点でこれが検証されている（console.log を足すとここで落ちる）
 *   - **create_note は add-only**: 既存ノートのファイル内容が書き込み前後で 1 バイトも変わらない
 *   - **返り値は必ず noteId / blockId を含む**: 引用の追跡可能性が Graphium の前提
 *   - **Graphium 本体の起動に依存しない**: vault のファイルだけで完結する
 *
 * 実行: pnpm test:e2e:mcp （または node e2e/mcp-smoke.mjs）
 *   - vault は OS 一時ディレクトリに作り、終了時に消す。実 vault には触れない
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ""}`);
  }
}

// ── fixture ───────────────────────────────────────────────
const NOTE_A = "aaaaaaaa-0000-4000-8000-000000000001";
const NOTE_B = "bbbbbbbb-0000-4000-8000-000000000002";

/** インラインラベル付きのテキストブロック（BlockNote の inline style として保存される） */
const labeled = (id, pairs) => ({
  id,
  type: "paragraph",
  props: {},
  content: pairs.map(([text, style]) => ({
    type: "text",
    text,
    styles: style ? { [style]: true } : {},
  })),
  children: [],
});

function buildVault() {
  const root = mkdtempSync(join(tmpdir(), "graphium-mcp-e2e-"));
  mkdirSync(join(root, "notes"), { recursive: true });
  mkdirSync(join(root, "appdata"), { recursive: true });

  // ノート A: 手順とラベルを持つ実験ノート。B の派生元でもある
  const noteA = {
    version: 2,
    title: "焼結条件の検討",
    pages: [
      {
        id: "main",
        title: "焼結条件の検討",
        blocks: [
          {
            id: "step-1",
            type: "step",
            props: {},
            content: [{ type: "text", text: "ホットプレス", styles: {} }],
            children: [labeled("blk-1", [["粉末", "material"], ["を ", null], ["グラファイトダイ", "tool"], ["で ", null], ["823 K", "attribute"], ["で焼結する", null]])],
          },
          {
            id: "step-2",
            type: "step",
            props: {},
            content: [{ type: "text", text: "XRD 測定", styles: {} }],
            children: [labeled("blk-2", [["XRD", "tool"], ["で相同定する", null]])],
          },
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    // A から派生したのが B（下流）
    noteLinks: [{ targetNoteId: NOTE_B, sourceBlockId: "step-2", type: "derived_from" }],
    source: "human",
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
  };

  // ノート B: A から派生した考察ノート（上流に A を持つ）
  const noteB = {
    version: 2,
    title: "焼結温度と粒径の関係",
    pages: [
      {
        id: "main",
        title: "焼結温度と粒径の関係",
        blocks: [labeled("blk-3", [["グラファイトダイ", "tool"], ["を使った試行では粒径が揃った", null]])],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    derivedFromNoteId: NOTE_A,
    derivedFromBlockId: "step-2",
    source: "human",
    createdAt: "2026-01-02T00:00:00.000Z",
    modifiedAt: "2026-01-02T00:00:00.000Z",
  };

  writeFileSync(join(root, "notes", `${NOTE_A}.json`), JSON.stringify(noteA, null, 2));
  writeFileSync(join(root, "notes", `${NOTE_B}.json`), JSON.stringify(noteB, null, 2));

  // note-index は本来フロントが作る。E2E ではその出力を模した最小構成を置く
  const index = {
    version: 25,
    updatedAt: "2026-01-02T00:00:00.000Z",
    notes: [
      {
        noteId: NOTE_A,
        title: noteA.title,
        modifiedAt: noteA.modifiedAt,
        createdAt: noteA.createdAt,
        headings: [],
        steps: [
          { blockId: "step-1", text: "ホットプレス" },
          { blockId: "step-2", text: "XRD 測定" },
        ],
        labels: [],
        outgoingLinks: [{ targetNoteId: NOTE_B, layer: "prov" }],
        inlineLabels: [
          { blockId: "blk-1", label: "material", text: "粉末", entityId: "ent_material_1" },
          { blockId: "blk-1", label: "tool", text: "グラファイトダイ", entityId: "ent_tool_1" },
          { blockId: "blk-1", label: "attribute", text: "823 K", entityId: "ent_attr_1" },
          { blockId: "blk-2", label: "tool", text: "XRD", entityId: "ent_tool_2" },
        ],
        source: "human",
      },
      {
        noteId: NOTE_B,
        title: noteB.title,
        modifiedAt: noteB.modifiedAt,
        createdAt: noteB.createdAt,
        headings: [],
        labels: [],
        outgoingLinks: [{ targetNoteId: NOTE_A, layer: "prov" }],
        inlineLabels: [
          { blockId: "blk-3", label: "tool", text: "グラファイトダイ", entityId: "ent_tool_3" },
        ],
        source: "human",
      },
    ],
  };
  writeFileSync(join(root, "appdata", "note-index.json"), JSON.stringify(index, null, 2));

  return root;
}

// ── 実行 ──────────────────────────────────────────────────
const root = buildVault();
console.log(`vault: ${root}\n`);

const transport = new StdioClientTransport({
  command: "pnpm",
  args: ["exec", "tsx", "src/mcp/index.ts"],
  cwd: ROOT,
  env: { ...process.env, GRAPHIUM_ROOT: root },
  stderr: "pipe",
});
const client = new Client({ name: "mcp-smoke", version: "1.0.0" });

const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args });
  return res.content?.[0]?.text ?? "";
};

try {
  // 接続できた時点で「stdout が JSON-RPC 専用に保たれている」が検証されている
  await client.connect(transport);

  const { tools } = await client.listTools();
  check("7 つのツールが登録されている", tools.length === 7, `got ${tools.length}: ${tools.map((t) => t.name).join(", ")}`);

  console.log("\n[read]");
  const search = await call("search_notes", { query: "焼結" });
  check("search_notes が両方のノートを引く", search.includes(NOTE_A) && search.includes(NOTE_B));

  const note = await call("get_note", { noteId: NOTE_A });
  check("get_note が本文と手順を返す", note.includes("ホットプレス") && note.includes("step-1"));

  const steps = await call("get_note_steps", { noteId: NOTE_A });
  check("get_note_steps が順序どおりに返す", steps.indexOf("1. ホットプレス") < steps.indexOf("2. XRD 測定"));
  check("get_note_steps が手順ごとの材料・道具・条件を返す", steps.includes("グラファイトダイ") && steps.includes("823 K"));
  check("get_note_steps が blockId を含む", steps.includes("step-1"));

  const using = await call("find_notes_using", { text: "グラファイトダイ" });
  check("find_notes_using が 2 ノートを横断する", using.includes(NOTE_A) && using.includes(NOTE_B));
  check("find_notes_using が blockId を含む", using.includes("blk-1") || using.includes("blk-3"));

  const entities = await call("list_entities", { minNotes: 2 });
  check("list_entities が横断するラベルだけに絞れる", entities.includes("グラファイトダイ") && !entities.includes("823 K"));

  const lineageB = await call("trace_lineage", { noteId: NOTE_B, direction: "upstream" });
  check("trace_lineage が derivedFromNoteId から上流を辿る", lineageB.includes(NOTE_A));

  const lineageA = await call("trace_lineage", { noteId: NOTE_A, direction: "downstream" });
  check("trace_lineage が noteLinks から下流を辿る", lineageA.includes(NOTE_B));

  console.log("\n[write]");
  const before = readdirSync(join(root, "notes"))
    .map((f) => [f, readFileSync(join(root, "notes", f), "utf8")])
    .sort();

  const created = await call("create_note", {
    title: "MCP から書いたノート",
    body: "# 見出し\n\n本文と **強調**。\n\n- 箇条書き\n",
    model: "test-model",
    sessionId: "smoke",
  });
  check("create_note が noteId を返す", /noteId: [0-9a-f-]{36}/.test(created));

  const after = readdirSync(join(root, "notes"));
  check("create_note でファイルが 1 件だけ増える", after.length === before.length + 1);

  const unchanged = before.every(([f, content]) => readFileSync(join(root, "notes", f), "utf8") === content);
  check("create_note が既存ノートを変更しない（add-only）", unchanged);

  const newId = created.match(/noteId: ([0-9a-f-]{36})/)?.[1];
  const newDoc = JSON.parse(readFileSync(join(root, "notes", `${newId}.json`), "utf8"));
  check("書き込みの経路が generatedBy に残る", String(newDoc.generatedBy?.agent).startsWith("graphium-mcp"));
  check("モデル ID が generatedBy に残る", newDoc.generatedBy?.model === "test-model");
  check("Markdown がブロックに変換される", newDoc.pages[0].blocks.some((b) => b.type === "heading"));

  const research = await call("search_notes", { query: "MCP から書いた" });
  check("作ったノートがそのまま検索で引ける", research.includes(newId));

  console.log("\n[error handling]");
  const missing = await call("get_note", { noteId: "00000000-0000-4000-8000-000000000000" });
  check("存在しないノートでクラッシュせずメッセージを返す", missing.includes("見つかりません"));
} finally {
  await client.close().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nmcp-smoke: 問題なし" : `\nmcp-smoke: ${failures} 件失敗`);
process.exit(failures === 0 ? 0 : 1);
