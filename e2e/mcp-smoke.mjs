#!/usr/bin/env node
/**
 * MCP サーバーの E2E スモークテスト（自己完結・決定論的）
 *
 * シナリオ:
 *   一時 vault に fixture ノートを 2 件置く
 *   → MCP クライアントとして接続し、10 ツールが登録されていることを確認
 *   → search / get_note / get_note_steps / find_notes_using / list_entities / trace_lineage
 *   → create_note で 3 件目を書き、そのまま検索で引けることを確認
 *   → get_note と同じ表記の数式・上付き・下付きを create_note で書き、数式・書式として保存され
 *     get_note が同じ表記で読み返すことを確認
 *   → create_note / save_answer で作った直後と、note-index を書き直して索引を組み直した後とで、
 *     検索に同じ語が当たることを確認（アプリが作ったものをまだ載せていない書き直しでも同じ）
 *   → 新しいセッションの最初の呼び出しで create_note / save_answer を書き、次の検索で引けることを確認
 *     （前のセッションで作り、note-index にまだ載っていないノートも引ける）
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

const serverParams = {
  command: "pnpm",
  args: ["exec", "tsx", "src/mcp/index.ts"],
  cwd: ROOT,
  env: { ...process.env, GRAPHIUM_ROOT: root },
  stderr: "pipe",
};
const transport = new StdioClientTransport(serverParams);
const client = new Client({ name: "mcp-smoke", version: "1.0.0" });

const callOn = async (target, name, args) => {
  const res = await target.callTool({ name, arguments: args });
  return res.content?.[0]?.text ?? "";
};
const call = (name, args) => callOn(client, name, args);

try {
  // 接続できた時点で「stdout が JSON-RPC 専用に保たれている」が検証されている
  await client.connect(transport);

  const { tools } = await client.listTools();
  check("10 のツールが登録されている", tools.length === 10, `got ${tools.length}: ${tools.map((t) => t.name).join(", ")}`);

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

  // get_note が返す表記（<sup> / <sub>・$…$・$$ … $$）をそのまま書き戻しても、文字のまま残らない
  const scripted = await call("create_note", {
    title: "数式と上付き・下付き",
    body: "圧力は 10<sup>5</sup> Pa、生成物は H<sub>2</sub>O。式 $E = mc^2$ で求める。\n\n$$ \\int_0^1 x\\,dx $$\n",
  });
  const scriptedId = scripted.match(/noteId: ([0-9a-f-]{36})/)?.[1];
  const scriptedBlocks = JSON.parse(readFileSync(join(root, "notes", `${scriptedId}.json`), "utf8")).pages[0].blocks;
  const inline = scriptedBlocks[0]?.content ?? [];
  check(
    "<sup> / <sub> が上付き・下付きの書式になる",
    inline.some((c) => c.text === "5" && c.styles?.superscript) && inline.some((c) => c.text === "2" && c.styles?.subscript),
  );
  check("$…$ がインライン数式になる", inline.some((c) => c.type === "inlineMath" && c.props?.latex === "E = mc^2"));
  check(
    "行に単独の $$ … $$ が数式ブロックになる",
    scriptedBlocks.some((b) => b.type === "math" && b.props?.latex === "\\int_0^1 x\\,dx"),
  );
  const reread = await call("get_note", { noteId: scriptedId });
  check(
    "get_note が同じ表記で読み返す",
    ["10<sup>5</sup> Pa", "H<sub>2</sub>O", "$E = mc^2$", "$$ \\int_0^1 x\\,dx $$"].every((s) => reread.includes(s)),
    reread,
  );

  console.log("\n[search index]");
  // create_note / save_answer は保存した直後に索引へ足し、組み直し（Graphium が note-index を
  // 書き直したとき・サーバーの再起動）ではファイルから読み直す。どちらも保存したドキュメントの
  // 平文から組むので同じ語が当たる（受け取った Markdown をそのまま入れていた頃は、作った直後だけ
  // タグ名 sup や引用の印 [[source:…]] の source で当たり、「105」「H2O」で外れた）
  const answered = await call("save_answer", {
    question: "焼結の圧力はいくつだったか",
    answer: `圧力は 10<sup>5</sup> Pa、生成物は H<sub>2</sub>O だった [[source:${NOTE_A}]]`,
    citations: [{ id: NOTE_A }],
  });
  const answerId = answered.match(/noteId: ([0-9a-f-]{36})/)?.[1];
  check("save_answer が noteId を返す", Boolean(answerId), answered);

  const QUERIES = ["105", "H2O", "sup", "sub", "source"];
  const matchingQueries = async (noteId) => {
    const matched = [];
    for (const query of QUERIES) {
      if ((await call("search_notes", { query })).includes(noteId)) matched.push(query);
    }
    return matched;
  };
  const justCreated = { note: await matchingQueries(scriptedId), answer: await matchingQueries(answerId) };
  check(
    "作った直後のノート・回答ページが平文の語で当たり、タグ名や引用の印では当たらない",
    JSON.stringify(justCreated) === JSON.stringify({ note: ["105", "H2O"], answer: ["105", "H2O"] }),
    JSON.stringify(justCreated),
  );

  // Graphium で別のノートを保存して note-index が書き直された状況を作る（更新時刻が変わり、次の
  // 検索で組み直す）。作った 2 件は、アプリが一覧を取り直すまで note-index に載らない
  const indexPath = join(root, "appdata", "note-index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  index.updatedAt = "2026-01-03T00:00:00.000Z";
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
  const notListed = { note: await matchingQueries(scriptedId), answer: await matchingQueries(answerId) };
  check(
    "アプリが載せる前に note-index を書き直して組み直しても、作った直後と同じ語が当たる",
    JSON.stringify(notListed) === JSON.stringify(justCreated),
    `直後: ${JSON.stringify(justCreated)} / 組み直し後: ${JSON.stringify(notListed)}`,
  );

  // Graphium が 2 件を拾って note-index を書き直した状況を作る
  const indexEntry = (noteId, title, extra) => ({
    noteId,
    title,
    modifiedAt: "2026-01-03T00:00:00.000Z",
    createdAt: "2026-01-03T00:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    ...extra,
  });
  index.notes.push(
    indexEntry(scriptedId, "数式と上付き・下付き", { source: "human" }),
    indexEntry(answerId, "焼結の圧力はいくつだったか", { source: "ai", wikiKind: "answer" }),
  );
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
  const rebuilt = { note: await matchingQueries(scriptedId), answer: await matchingQueries(answerId) };
  check(
    "アプリが載せた後に組み直しても、作った直後と同じ語が当たる",
    JSON.stringify(rebuilt) === JSON.stringify(justCreated),
    `直後: ${JSON.stringify(justCreated)} / 組み直し後: ${JSON.stringify(rebuilt)}`,
  );

  console.log("\n[new session]");
  // 索引は最初の検索で組むので、セッションの最初の呼び出しが保存だと、作ったものは組む時点の
  // note-index にまだ無い。それでも「保存して」→「探して」で引ける
  const second = new Client({ name: "mcp-smoke", version: "1.0.0" });
  try {
    await second.connect(new StdioClientTransport(serverParams));
    const firstNote = await callOn(second, "create_note", {
      title: "最初の呼び出しで書いたノート",
      body: "遊星ボールミルで 12 時間混合した",
    });
    const firstAnswer = await callOn(second, "save_answer", {
      question: "混合は何時間だったか",
      answer: `遊星ボールミルで 12 時間混合した [[source:${NOTE_A}]]`,
      citations: [{ id: NOTE_A }],
    });
    const firstIds = [firstNote, firstAnswer].map((reply) => reply.match(/noteId: ([0-9a-f-]{36})/)?.[1]);
    const found = await callOn(second, "search_notes", { query: "遊星ボールミル" });
    check(
      "索引を組む前に作ったノート・回答ページが、最初の検索で引ける",
      firstIds.every((id) => id && found.includes(id)),
      found,
    );

    // 前のセッションで create_note が書いたノート（note-index にはまだ載っていない）も引ける
    const earlier = await callOn(second, "search_notes", { query: "MCP から書いた" });
    check("前のセッションで作り、アプリがまだ載せていないノートも引ける", earlier.includes(newId), earlier);
  } finally {
    await second.close().catch(() => {});
  }

  console.log("\n[error handling]");
  const missing = await call("get_note", { noteId: "00000000-0000-4000-8000-000000000000" });
  check("存在しないノートでクラッシュせずメッセージを返す", missing.includes("見つかりません"));
} finally {
  await client.close().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nmcp-smoke: 問題なし" : `\nmcp-smoke: ${failures} 件失敗`);
process.exit(failures === 0 ? 0 : 1);
