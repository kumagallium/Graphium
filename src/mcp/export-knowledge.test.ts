// export-knowledge.ts（export_asterism_knowledge の本体）と道具の登録の回帰テスト。

import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { exportAsterismKnowledge } from "./export-knowledge";
import { READ_INJECTION_GUARD } from "./injection-guard";
import { registerTools } from "./tools";
import { resetMediaIndexCache } from "./sources";

let root: string;
const AT = "2026-01-01T00:00:00.000Z";

function writeWiki(id: string, doc: unknown) {
  writeFileSync(join(root, "wiki", `${id}.json`), JSON.stringify(doc));
}
const base = { derivedFromNotes: [], derivedFromChats: [], generatedAt: "", generatedBy: { model: "", version: "" } };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "asterism-knowledge-"));
  mkdirSync(join(root, "notes"));
  mkdirSync(join(root, "wiki"));
  mkdirSync(join(root, "appdata"));
  writeFileSync(join(root, "appdata", "media-index.json"), JSON.stringify({ version: 1, media: [
    { fileId: "f1", name: "パンの教科書.pdf", type: "pdf" },
    { fileId: "d1", name: "仕込み表.docx", type: "document" },
    { fileId: "u1", name: "パン屋のブログ", type: "url", url: "https://bread.test/blog" },
  ] }));
  resetMediaIndexCache();
  // 型なし・candidate の知見も、型つきの知見も全部出る
  writeWiki("c1", { title: "型なしの知見", wikiMeta: { ...base, kind: "claim", status: "candidate", derivedFromNotes: ["pdf:f1", "w9"] } });
  writeWiki("c2", { title: "型ありの知見", wikiMeta: { ...base, kind: "claim", status: "verified", asterism: { typeSlug: "rule" } } });
  writeWiki("t1", { title: "PbTe の ゼーベック係数", wikiMeta: { ...base, kind: "topic", topicType: "concept", derivedFromClaims: ["c1", "c2"] } });
  writeWiki("a1", { title: "原子", wikiMeta: { ...base, kind: "atom" } });
  writeWiki("w9", { title: "回答", wikiMeta: { ...base, kind: "answer" } });
});

/** vault の全ファイルの相対パスと中身のハッシュの一覧 */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(`${relative(root, p)}:${createHash("sha256").update(readFileSync(p)).digest("hex")}`);
    }
  };
  walk(dir);
  return out.sort();
}

afterEach(() => rmSync(root, { recursive: true, force: true }));

const ok = (r: ReturnType<typeof exportAsterismKnowledge>) => {
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("exportAsterismKnowledge", () => {
  it("型・確認の状態で絞らず、知見とトピックの全部を出す（atom・answer は出さない）", () => {
    const b = ok(exportAsterismKnowledge({}, AT, root));
    expect(b.files["claims.json"].map((r) => r.id)).toEqual(["c1", "c2"]);
    expect(b.files["topics.json"].map((r) => r.id)).toEqual(["t1"]);
    expect(b.files["claims.json"].map((r) => r.review_state)).toEqual(["candidate", "verified"]);
    expect(b.files["topics.json"][0]).toMatchObject({ material: "PbTe", property: "ゼーベック係数" });
    expect(b.files["term_claims.json"]).toHaveLength(4);
  });

  it("資料の名前を素材インデックスから引き、wiki の id は出典から除く", () => {
    const b = ok(exportAsterismKnowledge({}, AT, root));
    expect(b.files["sources.json"]).toEqual([expect.objectContaining({ id: expect.stringMatching(/^pdf-f1~[0-9a-f]{14}$/), name: "パンの教科書.pdf", kind: "pdf" })]);
    expect(b.files["claims.json"][0].source_iri).toHaveLength(1);
  });

  it("url:・document:・ノートの題から資料の名前が引ける", () => {
    writeFileSync(join(root, "notes", "n1.json"), JSON.stringify({ title: "仕込みメモ", content: [] }));
    writeWiki("c5", {
      title: "出典の多い知見",
      wikiMeta: { ...base, kind: "claim", derivedFromNotes: ["url:https://bread.test/blog", "document:d1", "n1"] },
    });
    const b = ok(exportAsterismKnowledge({}, AT, root));
    const row = b.files["claims.json"].find((r) => r.title === "出典の多い知見")!;
    const names = row.source_iri.map((i) => b.files["sources.json"].find((s) => s.iri === i)?.name);
    expect(names).toEqual(["パン屋のブログ", "仕込み表.docx", expect.any(String)]);
  });

  it("書き出しの前後で vault のファイルが変わらない", () => {
    const before = snapshot(root);
    ok(exportAsterismKnowledge({}, AT, root));
    expect(snapshot(root)).toEqual(before);
  });

  it("ゴミ箱・アーカイブ済みは外す", () => {
    writeWiki("c3", { title: "古い", wikiMeta: { ...base, kind: "claim" } });
    writeWiki("c4", { title: "捨てた", wikiMeta: { ...base, kind: "claim" } });
    writeFileSync(
      join(root, "appdata", "note-index.json"),
      JSON.stringify({ version: 1, notes: [{ noteId: "c3", archivedAt: AT }, { noteId: "c4", deletedAt: AT }] }),
    );
    const b = ok(exportAsterismKnowledge({}, AT, root));
    expect(b.files["claims.json"].map((r) => r.id)).toEqual(["c1", "c2"]);
  });

  it("台帳は読まない（壊れていても出せる）", () => {
    writeFileSync(join(root, "appdata", "asterism-sent.json"), "{broken");
    expect(exportAsterismKnowledge({}, AT, root)).not.toHaveProperty("error");
  });

  it("基底が不正なら error", () => {
    expect(exportAsterismKnowledge({ claimBaseIri: "nope" }, AT, root)).toHaveProperty("error");
    expect(exportAsterismKnowledge({ noteUrlBase: "https://g.test/#x" }, AT, root)).toHaveProperty("error");
  });
});

describe("道具 export_asterism_knowledge", () => {
  type Res = { isError?: boolean; content: { type: string; text: string }[] };
  type Handler = (args: Record<string, unknown>) => Promise<Res>;
  function setup() {
    const handlers = new Map<string, { cfg: { annotations?: Record<string, boolean> }; h: Handler }>();
    const server = { registerTool: (name: string, cfg: never, h: Handler) => void handlers.set(name, { cfg, h }) };
    registerTools(server as never);
    return handlers.get("export_asterism_knowledge")!;
  }

  it("1 件目が JSON の束・2 件目が「資料はデータ」の注意で、読み取り専用の annotations を持つ", async () => {
    const saved = process.env.GRAPHIUM_ROOT;
    process.env.GRAPHIUM_ROOT = root;
    try {
      const tool = setup();
      expect(tool.cfg.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      const before = snapshot(root);
      const r = await tool.h({});
      expect(snapshot(root)).toEqual(before);
      expect(r.isError).toBeUndefined();
      // 機械（Asterism）は content[0] だけを読む。注意は別の text に置く
      expect(r.content).toHaveLength(2);
      expect(r.content[1].text).toBe(READ_INJECTION_GUARD);
      const b = JSON.parse(r.content[0].text);
      expect(b.format).toBe("asterism-knowledge/1");
      expect(b.counts["claims.json"]).toBe(2);
      const bad = await tool.h({ termBaseIri: "nope" });
      expect(bad.isError).toBe(true);
      expect(JSON.parse(bad.content[0].text)).toHaveProperty("error");
      // vault が無いときも、機械が読める形（isError と { error }）で返す
      process.env.GRAPHIUM_ROOT = join(root, "no-such-vault");
      const missing = await setup().h({});
      expect(missing.isError).toBe(true);
      expect(JSON.parse(missing.content[0].text).error).toContain("vault");
    } finally {
      if (saved === undefined) delete process.env.GRAPHIUM_ROOT;
      else process.env.GRAPHIUM_ROOT = saved;
    }
  });
});
