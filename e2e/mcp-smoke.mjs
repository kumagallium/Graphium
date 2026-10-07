#!/usr/bin/env node
/**
 * MCP サーバーの E2E スモークテスト（自己完結・決定論的）
 *
 * シナリオ:
 *   一時 vault に fixture ノートを 2 件置く
 *   → MCP クライアントとして接続し、期待するツール名がすべて登録されていることを確認
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
 * 実行: pnpm test:e2e:mcp （bundle 経由は pnpm test:e2e:mcp -- --bundle）
 *   - vault は OS 一時ディレクトリに作り、終了時に消す。実 vault には触れない
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildMinimalDocx, buildMinimalPdf } from "../src/mcp/test-support.ts";

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
const TOPIC_1 = "dddddddd-0000-4000-8000-000000000011";
const TOPIC_2 = "dddddddd-0000-4000-8000-000000000012";
const TOPIC_ORPHAN = "dddddddd-0000-4000-8000-000000000021";
const TOPIC_CONTRA = "dddddddd-0000-4000-8000-000000000022";
const PDF_ID = "pdffile0001";
const DOCX_ID = "docxfile0001";
const PDF_NAME = "report-sintering.pdf";
const DOCX_NAME = "report-protocol.docx";
const PDF_PAGES = ["Alpha introduction text", "Beta middle section", "Gamma conclusion words"];
const DOCX_PARAS = ["Delta protocol heading", "Epsilon procedure details"];

// 期待するツール名（件数は直書きしない）
const EXPECTED_TOOLS = [
  // 既存
  "search_notes", "list_topics", "get_topic", "get_note", "get_note_steps",
  "find_notes_using", "list_entities", "trace_lineage", "create_note", "save_answer",
  // 手入れ
  "revise_topic", "merge_topics", "archive_page", "restore_page", "list_operations", "undo_operation",
  // 読む側
  "export_prov", "get_source_text", "search_media", "check_knowledge", "list_source_check",
];

const USE_BUNDLE = process.argv.includes("--bundle");

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
  mkdirSync(join(root, "wiki"), { recursive: true });
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

  // wiki のトピック 2 件（新形式: topicMarkdown あり）。手入れのツールの対象
  for (const [id, title, md] of [
    [TOPIC_1, "ボールミル混合の知見", "遊星式のミルで粉末を混合すると凝集がほぐれる"],
    [TOPIC_2, "粉末混合の注意点", "混合時間が長いと容器の摩耗粉が混ざる"],
  ]) {
    writeFileSync(
      join(root, "wiki", `${id}.json`),
      JSON.stringify(
        {
          version: 2,
          title,
          source: "ai",
          pages: [{ id: "main", title, blocks: [labeled(`${id}-b1`, [[md, null]])], labels: {}, provLinks: [], knowledgeLinks: [] }],
          wikiMeta: { kind: "topic", derivedFromNotes: id === TOPIC_1 ? [NOTE_A, `pdf:${PDF_ID}`] : [NOTE_A], derivedFromClaims: [], topicMarkdown: md },
          createdAt: "2026-01-05T00:00:00.000Z",
          modifiedAt: "2026-01-05T00:00:00.000Z",
        },
        null,
        2,
      ),
    );
  }

  // 孤立（出どころなし）のトピックと、出典照合が contradicted のトピック
  for (const [id, title, md, extra] of [
    [TOPIC_ORPHAN, "出どころの無い孤立トピック", "孤立した知見の本文", { derivedFromNotes: [] }],
    [
      TOPIC_CONTRA,
      "出典と食い違うトピック",
      "出典と矛盾する知見の本文",
      {
        derivedFromNotes: [NOTE_A],
        sourceCheck: {
          verdict: "contradicted",
          entries: [{ sourceId: NOTE_A, sourceKind: "note", verdict: "contradicted", rationale: "出典は逆のことを述べている" }],
          checkedAt: "2026-01-06T00:00:00.000Z",
          checkedBy: "local",
          claimHash: "h",
        },
      },
    ],
  ]) {
    writeFileSync(
      join(root, "wiki", `${id}.json`),
      JSON.stringify({
        version: 2,
        title,
        source: "ai",
        pages: [{ id: "main", title, blocks: [labeled(`${id}-b1`, [[md, null]])], labels: {}, provLinks: [], knowledgeLinks: [] }],
        wikiMeta: { kind: "topic", derivedFromClaims: [], topicMarkdown: md, ...extra },
        createdAt: "2026-01-06T00:00:00.000Z",
        modifiedAt: "2026-01-06T00:00:00.000Z",
      }),
    );
  }

  // 素材（PDF・docx）と素材インデックス
  mkdirSync(join(root, "media"), { recursive: true });
  writeFileSync(join(root, "media", `${PDF_ID}.pdf`), buildMinimalPdf(PDF_PAGES));
  writeFileSync(join(root, "media", `${DOCX_ID}.docx`), buildMinimalDocx(DOCX_PARAS));
  writeFileSync(
    join(root, "appdata", "media-index.json"),
    JSON.stringify({
      media: [
        { fileId: PDF_ID, name: PDF_NAME, type: "pdf", mimeType: "application/pdf", url: "", thumbnailUrl: "", uploadedAt: "2026-01-03T00:00:00.000Z", usedIn: [] },
        {
          fileId: DOCX_ID,
          name: DOCX_NAME,
          type: "document",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          url: "",
          thumbnailUrl: "",
          uploadedAt: "2026-01-03T00:00:00.000Z",
          usedIn: [],
        },
      ],
    }),
  );

  // note-index は本来フロントが作る。E2E ではその出力を模した最小構成を置く
  const index = {
    // INDEX_SCHEMA_VERSION（src/features/navigation/index-file.ts）と同じ値
    version: 30,
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
      ...[
        [TOPIC_1, "ボールミル混合の知見"],
        [TOPIC_2, "粉末混合の注意点"],
        [TOPIC_ORPHAN, "出どころの無い孤立トピック"],
        [TOPIC_CONTRA, "出典と食い違うトピック"],
      ].map(([noteId, title]) => ({
        noteId,
        title,
        modifiedAt: "2026-01-05T00:00:00.000Z",
        createdAt: "2026-01-05T00:00:00.000Z",
        headings: [],
        labels: [],
        outgoingLinks: [],
        source: "ai",
        wikiKind: "topic",
      })),
    ],
  };
  writeFileSync(join(root, "appdata", "note-index.json"), JSON.stringify(index, null, 2));

  return root;
}

// ── 実行 ──────────────────────────────────────────────────
const root = buildVault();
console.log(`vault: ${root}\n`);

// bundle モード: 配布用の単一ファイルを作り、それをサーバーとして起動する
let bundleDir = null;
let bundlePath = null;
if (USE_BUNDLE) {
  // pdfjs-dist / mammoth は external（実行時に bundle の位置から解決する）ので、
  // リポジトリの node_modules が見える場所（node_modules/.cache・git 管理外）に出す
  const cacheDir = join(ROOT, "node_modules", ".cache");
  mkdirSync(cacheDir, { recursive: true });
  bundleDir = mkdtempSync(join(cacheDir, "graphium-mcp-bundle-"));
  bundlePath = join(bundleDir, "graphium-mcp.mjs");
  const built = spawnSync("node", ["scripts/bundle-mcp.mjs", "--outfile", bundlePath], { cwd: ROOT, encoding: "utf8" });
  if (built.status !== 0) {
    console.error(`bundle の生成に失敗\n${built.stderr}`);
    rmSync(bundleDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
    process.exit(1);
  }
  console.log(`bundle モード: ${bundlePath}`);
}

const serverParams = {
  command: USE_BUNDLE ? "node" : "pnpm",
  args: USE_BUNDLE ? [bundlePath] : ["exec", "tsx", "src/mcp/index.ts"],
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
  const registered = new Set(tools.map((t) => t.name));
  const missingTools = EXPECTED_TOOLS.filter((n) => !registered.has(n));
  const extraTools = [...registered].filter((n) => !EXPECTED_TOOLS.includes(n));
  check(
    "登録されたツールが期待する名前と過不足なく一致する",
    missingTools.length === 0 && extraTools.length === 0 && tools.length === EXPECTED_TOOLS.length,
    `未登録: ${missingTools.join(", ")} / 想定外: ${extraTools.join(", ")}`,
  );

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

  const mermaid = await call("get_note_steps", { noteId: NOTE_A, format: "mermaid" });
  check("get_note_steps が mermaid 形式で返す", mermaid.includes("```mermaid") && mermaid.includes("flowchart"), mermaid);

  const prov = await call("export_prov", { noteId: NOTE_A });
  check("export_prov が JSON-LD（@context と prov:）を返す", prov.includes("@context") && prov.includes("prov:"), prov.slice(0, 300));

  const topicWithPdf = await call("get_topic", { topicId: TOPIC_1 });
  check("get_topic が素材の資料名を引ける", topicWithPdf.includes(PDF_NAME), topicWithPdf);

  const pdfText = await call("get_source_text", { sourceId: `pdf:${PDF_ID}` });
  check("get_source_text(pdf) が窓の見出しにページを含み本文を返す", pdfText.includes("ページ") && pdfText.includes("Alpha introduction"), pdfText);
  const pdfPage3 = await call("get_source_text", { sourceId: `pdf:${PDF_ID}`, page: 3 });
  check("get_source_text(pdf, page: 3) が 3 ページ目の語を含む", pdfPage3.includes("Gamma conclusion"), pdfPage3);
  const docxText = await call("get_source_text", { sourceId: `document:${DOCX_ID}` });
  check("get_source_text(document) が docx の本文を返す", docxText.includes("Delta protocol") && docxText.includes("Epsilon procedure"), docxText);
  const unknownSrc = await call("get_source_text", { sourceId: "pdf:no-such-file" });
  check("get_source_text が存在しない id で UNKNOWN_SOURCE を返す", unknownSrc.includes("UNKNOWN_SOURCE"), unknownSrc);

  const mediaByName = await call("search_media", { query: "report-sintering" });
  check("search_media が PDF の名前で引ける", mediaByName.includes(PDF_NAME) && mediaByName.includes(PDF_ID), mediaByName);
  const mediaDocs = await call("search_media", { query: "report", type: "document" });
  check("search_media が type: document で docx だけに絞れる", mediaDocs.includes(DOCX_NAME) && !mediaDocs.includes(PDF_NAME), mediaDocs);

  const knowledge = await call("check_knowledge", {});
  check("check_knowledge が孤立のトピックを挙げる", knowledge.includes(TOPIC_ORPHAN), knowledge);
  const sourceCheckList = await call("list_source_check", {});
  check("list_source_check が contradicted のトピックを挙げる", sourceCheckList.includes(TOPIC_CONTRA), sourceCheckList);

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

  console.log("\n[external write]");
  // Skill の save.mjs など、note-index.json を意図的に書き換えない経路が notes/ に直接ファイルを
  // 足すケース。件数の変化で検知し、note-index.json の更新を待たずに次の検索に出ることを確認する
  const EXTERNAL_NOTE = "cccccccc-0000-4000-8000-000000000003";
  writeFileSync(
    join(root, "notes", `${EXTERNAL_NOTE}.json`),
    JSON.stringify(
      {
        version: 2,
        title: "外部プロセスが足したノート",
        pages: [
          {
            id: "main",
            title: "外部プロセスが足したノート",
            blocks: [labeled("blk-ext", [["ジェットミル", null]])],
            labels: {},
            provLinks: [],
            knowledgeLinks: [],
          },
        ],
        source: "human",
        createdAt: "2026-01-04T00:00:00.000Z",
        modifiedAt: "2026-01-04T00:00:00.000Z",
      },
      null,
      2,
    ),
  );
  const externalFound = await call("search_notes", { query: "ジェットミル" });
  check(
    "note-index.json を触らず notes/ に直接足したファイルも、次の検索に出る",
    externalFound.includes(EXTERNAL_NOTE),
    externalFound,
  );

  console.log("\n[upkeep]");
  const readIdx = () => JSON.parse(readFileSync(indexPath, "utf8"));
  const entryOf = (id) => readIdx().notes.find((n) => n.noteId === id);
  const idsOf = (reply) => ({
    runId: reply.match(/runId: (maint-run-\S+)/)?.[1],
    operationId: reply.match(/operationId: (\S+)/)?.[1],
  });

  // revise_topic → get_topic → list_operations → search_notes → undo_operation
  const revised = await call("revise_topic", {
    topicId: TOPIC_1,
    body: `ジェットミルでも粉末を解砕できる [[source:${NOTE_A}]]`,
    model: "test-model",
  });
  const revisedIds = idsOf(revised);
  check("revise_topic が runId / operationId を返す", Boolean(revisedIds.runId && revisedIds.operationId), revised);
  check("get_topic の本文が変わる", (await call("get_topic", { topicId: TOPIC_1 })).includes("ジェットミルでも粉末を解砕"));
  const ops = await call("list_operations", {});
  check("list_operations に 1 件・取り消せます", ops.includes(revisedIds.operationId) && ops.includes("取り消せます"), ops);
  check("search_notes で新しい語が引ける", (await call("search_notes", { query: "解砕" })).includes(TOPIC_1));
  const undone = await call("undo_operation", revisedIds);
  check("undo_operation が成功する", undone.includes("取り消しました"), undone);
  const reverted = await call("get_topic", { topicId: TOPIC_1 });
  check("取り消すと本文が戻る", reverted.includes("凝集がほぐれる") && !reverted.includes("解砕"), reverted);

  // merge_topics → 吸収側が消える → undo
  const merged = await call("merge_topics", {
    keepId: TOPIC_1,
    absorbIds: [TOPIC_2],
    body: `混合では凝集と摩耗粉の両方に注意する [[source:${NOTE_A}]]`,
  });
  check("merge_topics が成功する", merged.includes("統合しました"), merged);
  check("吸収側が search_notes から消える", !(await call("search_notes", { query: "粉末混合の注意点" })).includes(TOPIC_2));
  check("note-index.json の吸収側に deletedAt が立つ", Boolean(entryOf(TOPIC_2)?.deletedAt));
  const mergeUndone = await call("undo_operation", idsOf(merged));
  check("統合を取り消せる", mergeUndone.includes("取り消しました"), mergeUndone);
  check(
    "吸収側が戻る（deletedAt なし・検索に出る）",
    !entryOf(TOPIC_2)?.deletedAt && (await call("search_notes", { query: "粉末混合の注意点" })).includes(TOPIC_2),
  );

  // archive_page → restore_page
  const archived = await call("archive_page", { pageIds: [TOPIC_2] });
  check("archive_page が成功し archivedAt が立つ", archived.includes("アーカイブしました") && Boolean(entryOf(TOPIC_2)?.archivedAt), archived);
  const restored = await call("restore_page", { pageId: TOPIC_2 });
  check("restore_page で戻る", restored.includes("戻しました") && !entryOf(TOPIC_2)?.archivedAt, restored);

  // 索引に無い wiki ページを直接置いて archive_page
  const UNLISTED = "dddddddd-0000-4000-8000-000000000013";
  writeFileSync(
    join(root, "wiki", `${UNLISTED}.json`),
    JSON.stringify({
      version: 2,
      title: "索引に無いトピック",
      source: "ai",
      pages: [{ id: "main", title: "索引に無いトピック", blocks: [labeled("u-b1", [["未掲載の本文", null]])], labels: {}, provLinks: [], knowledgeLinks: [] }],
      wikiMeta: { kind: "topic", derivedFromNotes: [NOTE_A], derivedFromClaims: [], topicMarkdown: "未掲載の本文" },
      modifiedAt: "2026-01-06T00:00:00.000Z",
    }),
  );
  check("（前提）索引にエントリが無い", !entryOf(UNLISTED));
  const archivedUnlisted = await call("archive_page", { pageIds: [UNLISTED] });
  check(
    "索引に無いページを archive_page するとエントリが挿入され archivedAt が立つ",
    Boolean(entryOf(UNLISTED)?.archivedAt),
    archivedUnlisted,
  );

  // ハートビート: 新しければ APP_RUNNING、2 分前なら通る
  const heartbeatPath = join(root, "appdata", "app-heartbeat.json");
  try {
    writeFileSync(heartbeatPath, JSON.stringify({ via: "web", at: new Date().toISOString() }));
    const running = await call("revise_topic", { topicId: TOPIC_1, body: "起動中の書き換え" });
    check("新しいハートビートがあると APP_RUNNING で断る", running.startsWith("APP_RUNNING"), running);
    check("断られたときは本文を変えない", !(await call("get_topic", { topicId: TOPIC_1 })).includes("起動中の書き換え"));
    writeFileSync(heartbeatPath, JSON.stringify({ via: "web", at: new Date(Date.now() - 120_000).toISOString() }));
    const pass = await call("revise_topic", { topicId: TOPIC_1, body: "2 分前の起動なら通る" });
    check("2 分前のハートビートなら通る", pass.includes("書き直しました"), pass);
  } finally {
    rmSync(heartbeatPath, { force: true });
  }

  console.log("\n[error handling]");
  const missing = await call("get_note", { noteId: "00000000-0000-4000-8000-000000000000" });
  check("存在しないノートでクラッシュせずメッセージを返す", missing.includes("見つかりません"));
} finally {
  await client.close().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}

if (USE_BUNDLE) {
  // bundle に UI 側の依存（react-dom）が紛れ込んでいないこと
  const text = readFileSync(bundlePath, "utf8");
  check("bundle に react-dom が含まれない", !text.includes("react-dom"));
  console.log(`  bundle サイズ: ${(statSync(bundlePath).size / 1024).toFixed(0)} KB`);
  rmSync(bundleDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nmcp-smoke: 問題なし" : `\nmcp-smoke: ${failures} 件失敗`);
process.exit(failures === 0 ? 0 : 1);
