// テンプレートのファイル（.graphium-template）の読み書きのテスト。
import { describe, it, expect } from "vitest";
import {
  TEMPLATE_FILE_MAX_MEDIA_BYTES,
  buildTemplateFile,
  parseTemplateFile,
  prepareTemplateImport,
  serializeTemplateFile,
  templateFileName,
  uniqueTemplateTitle,
} from "./template-file";
import type { PageTemplate } from "./types";

// 1x1 の PNG（マジックバイトで image/png と判定される）
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const template = (blocks: any[] = []): PageTemplate => ({
  name: "Sourdough feeding log",
  savedAt: "2026-11-01T00:00:00Z",
  pageTitle: "Feeding log",
  blocks,
  labels: [["b1", "[手順]"]],
  attributes: [],
});

const imageBlock = (url: string) => ({ id: "img", type: "image", props: { url, name: "starter.png" } });
const extractFileId = (url: string) => (url.startsWith("local:") ? url.slice(6) : null);

describe("templateFileName", () => {
  it("拡張子を付け、使えない文字は置き換える", () => {
    expect(templateFileName("A/B: log")).toBe("A_B_ log.graphium-template");
    expect(templateFileName("")).toBe("Template.graphium-template");
  });
});

describe("uniqueTemplateTitle", () => {
  it("重なるときは（2）（3）を付ける", () => {
    expect(uniqueTemplateTitle("A", ["B"])).toBe("A");
    expect(uniqueTemplateTitle("A", ["A"])).toBe("A（2）");
    expect(uniqueTemplateTitle("A", ["A", "A（2）"])).toBe("A（3）");
  });
});

describe("書き出し → 読み込みの往復", () => {
  it("素材なし: 同じ中身に戻り、元のノートの題名は書き出さない", async () => {
    const built = await buildTemplateFile({
      title: "Sourdough feeding log",
      description: "毎日の記録",
      template: template([{ id: "b1", type: "paragraph" }]),
      now: new Date("2026-11-06T00:00:00Z"),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.file.format).toBe("graphium-template");
    expect(built.file.version).toBe(1);
    expect(built.file.media).toBeUndefined();
    expect(JSON.stringify(built.file)).not.toContain("sourceNote");

    const parsed = parseTemplateFile(serializeTemplateFile(built.file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file.title).toBe("Sourdough feeding log");
    expect(parsed.file.description).toBe("毎日の記録");
    expect(parsed.file.template.blocks).toEqual([{ id: "b1", type: "paragraph" }]);
    expect(parsed.file.template.labels).toEqual([["b1", "[手順]"]]);
    expect(JSON.stringify(parsed.file)).not.toContain('"id":"note');
  });

  it("手元の素材を同梱し、読み込みで手元の素材に付け替える", async () => {
    const built = await buildTemplateFile({
      title: "T",
      template: template([imageBlock("local:file-1"), imageBlock("local:file-1"), imageBlock("https://example.com/x.png")]),
      extractFileId,
      fetchLocalBytes: async () => PNG,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // 同じ素材は 1 つにまとまり、外部 URL は触らない
    expect(built.file.media).toHaveLength(1);
    expect(built.file.media![0].hash).toMatch(/^sha256:/);
    expect(built.file.media![0].mime).toBe("image/png");
    const urls = built.file.template.blocks.map((b) => b.props.url);
    expect(urls[0]).toBe(`shared-blob:${built.file.media![0].hash}`);
    expect(urls[2]).toBe("https://example.com/x.png");

    const parsed = parseTemplateFile(serializeTemplateFile(built.file));
    if (!parsed.ok) throw new Error("parse");
    const uploaded: File[] = [];
    const prepared = await prepareTemplateImport(parsed.file, {
      uploadMedia: async (f) => {
        uploaded.push(f);
        return { url: `local:uploaded-${uploaded.length}` };
      },
      existingTitles: [],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(uploaded).toHaveLength(1);
    expect(new Uint8Array(await uploaded[0].arrayBuffer())).toEqual(PNG);
    expect(prepared.template.blocks.map((b) => b.props.url)).toEqual([
      "local:uploaded-1",
      "local:uploaded-1",
      "https://example.com/x.png",
    ]);
    expect(prepared.missing).toBe(0);
  });

  it("共有テンプレートの shared-blob を置き場から読んで同梱する。読めない分は missing", async () => {
    const hash = "sha256:aaaa";
    const built = await buildTemplateFile({
      title: "T",
      template: template([imageBlock(`shared-blob:${hash}`), imageBlock("shared-blob:sha256:bbbb")]),
      fetchBlobBytes: async (h) => (h === hash ? { bytes: PNG, filename: "a.png" } : null),
    });
    if (!built.ok) throw new Error("build");
    expect(built.file.media).toHaveLength(1);
    expect(built.file.media![0]).toMatchObject({ hash, filename: "starter.png" });
    expect(built.missing).toBe(1);
  });

  it("同梱する素材が大きすぎるときは作らず、理由を返す", async () => {
    const big = new Uint8Array(TEMPLATE_FILE_MAX_MEDIA_BYTES + 1);
    const built = await buildTemplateFile({
      title: "T",
      template: template([imageBlock("local:big")]),
      extractFileId,
      fetchLocalBytes: async () => big,
    });
    expect(built).toMatchObject({ ok: false, reason: "tooLarge" });
  });

  it("題名が重なれば（2）を付け、ファイルに元のノートがあっても取り込まない", async () => {
    const parsed = parseTemplateFile(
      JSON.stringify({
        format: "graphium-template",
        version: 1,
        title: "Log",
        sourceNote: { title: "Origin", id: "should-be-ignored" },
        template: template(),
      }),
    );
    if (!parsed.ok) throw new Error("parse");
    const prepared = await prepareTemplateImport(parsed.file, {
      uploadMedia: async () => ({ url: "x" }),
      existingTitles: ["Log"],
    });
    if (!prepared.ok) throw new Error("prepare");
    expect(prepared.title).toBe("Log（2）");
    expect(prepared.template.name).toBe("Log（2）");
    expect("sourceNote" in prepared).toBe(false);
  });

  it("同梱の素材の hash が合わなければ壊れたファイルとして断る", async () => {
    const parsed = parseTemplateFile(
      JSON.stringify({
        format: "graphium-template",
        version: 1,
        title: "Log",
        template: template([imageBlock("shared-blob:sha256:dead")]),
        media: [{ hash: "sha256:dead", base64: "AQID" }],
      }),
    );
    if (!parsed.ok) throw new Error("parse");
    const prepared = await prepareTemplateImport(parsed.file, {
      uploadMedia: async () => ({ url: "x" }),
      existingTitles: [],
    });
    expect(prepared).toMatchObject({ ok: false, reason: "corrupt" });
  });
});

describe("素材のファイル名と種類", () => {
  const cases: [string, number[], string][] = [
    ["protocol.docx", [0x50, 0x4b, 3, 4], "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["data.xlsx", [0x50, 0x4b, 3, 4, 9], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["rows.csv", [0x61, 0x2c, 0x62, 0x0a], "text/csv"],
    ["rise.wav", [0x52, 0x49, 0x46, 0x46, 1, 1, 1, 1, 0x57, 0x41, 0x56, 0x45], "audio/wav"],
    ["memo.m4a", [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20], "audio/mp4"],
  ];
  it.each(cases)("%s の名前と種類が往復で戻る", async (name, raw, mime) => {
    const bytes = new Uint8Array(raw);
    const built = await buildTemplateFile({
      title: "T",
      template: template([{ id: "f", type: "file", props: { url: "local:f1", name } }]),
      extractFileId,
      fetchLocalBytes: async () => bytes,
    });
    if (!built.ok) throw new Error("build");
    expect(built.file.media![0]).toMatchObject({ filename: name, mime });
    const parsed = parseTemplateFile(serializeTemplateFile(built.file));
    if (!parsed.ok) throw new Error("parse");
    const uploaded: File[] = [];
    const prepared = await prepareTemplateImport(parsed.file, {
      uploadMedia: async (f) => (uploaded.push(f), { url: "local:new" }),
      existingTitles: [],
    });
    expect(prepared.ok).toBe(true);
    expect(uploaded[0].name).toBe(name);
    expect(uploaded[0].type).toBe(mime);
  });
});

describe("相手の環境で意味の無いものを外す", () => {
  it("読めなかった素材・同梱されない shared-blob は url を空にし、元のパスを残さない", async () => {
    const built = await buildTemplateFile({
      title: "T",
      template: template([imageBlock("local:broken"), imageBlock("shared-blob:sha256:gone")]),
      extractFileId,
      fetchLocalBytes: async () => {
        throw new Error("x");
      },
      fetchBlobBytes: async () => null,
    });
    if (!built.ok) throw new Error("build");
    expect(built.missing).toBe(2);
    expect(built.file.template.blocks.map((b) => b.props.url)).toEqual(["", ""]);
    expect(JSON.stringify(built.file)).not.toContain("local:broken");
  });

  it("読み込み時、同梱の無い shared-blob が残っていれば空にする", async () => {
    const parsed = parseTemplateFile(
      JSON.stringify({ format: "graphium-template", version: 1, title: "T", template: template([imageBlock("shared-blob:sha256:zz")]) }),
    );
    if (!parsed.ok) throw new Error("parse");
    const prepared = await prepareTemplateImport(parsed.file, { uploadMedia: async () => ({ url: "x" }), existingTitles: [] });
    if (!prepared.ok) throw new Error("prepare");
    expect(prepared.template.blocks[0].props.url).toBe("");
    expect(prepared.missing).toBe(1);
  });

  it("録音ブロックの id と表の行ノートリンクを外す", async () => {
    const t0 = {
      ...template([
        { id: "m", type: "meetingTranscript", props: { recordingId: "r1", fileId: "f1", startedAt: "2026-01-01" } },
        { id: "c", type: "column", children: [{ id: "m2", type: "meetingTranscript", props: { recordingId: "r2", fileId: "f2", startedAt: "x" } }] },
      ]),
      tableMeta: { tb: { noteLinks: { "row-1": "note-abc" }, name: "表" } as any },
    };
    const built = await buildTemplateFile({ title: "T", template: t0 });
    if (!built.ok) throw new Error("build");
    const text = JSON.stringify(built.file);
    expect(text).not.toContain("r1");
    expect(text).not.toContain("f2");
    expect(text).not.toContain("note-abc");
    expect(built.file.template.tableMeta!.tb).toEqual({ name: "表" });
    // 元は変えない
    expect((t0.blocks[0] as any).props.recordingId).toBe("r1");
  });
});

describe("parseTemplateFile の検証", () => {
  it("本文の形が違えば壊れたファイルとして断る", () => {
    const base = { format: "graphium-template", version: 1, title: "T" };
    const bad = (template: unknown) => parseTemplateFile(JSON.stringify({ ...base, template }));
    expect(bad({ blocks: [1] })).toMatchObject({ ok: false, reason: "invalid", detail: "blocks" });
    expect(bad({ blocks: [null] })).toMatchObject({ ok: false, detail: "blocks" });
    expect(bad({ blocks: [], labels: [["a"]] })).toMatchObject({ ok: false, detail: "labels" });
    expect(bad({ blocks: [], labels: [[1, "x"]] })).toMatchObject({ ok: false, detail: "labels" });
    expect(bad({ blocks: [], attributes: ["x"] })).toMatchObject({ ok: false, detail: "attributes" });
    expect(bad({ blocks: [], tableMeta: [] })).toMatchObject({ ok: false, detail: "tableMeta" });
    expect(bad({ blocks: [], tableMeta: { a: null } })).toMatchObject({ ok: false, detail: "tableMeta" });
    expect(bad({ blocks: [], mediaInlineLabels: { a: "x" } })).toMatchObject({ ok: false, detail: "mediaInlineLabels" });
    expect(bad({ blocks: [{ id: "a" }], labels: [["a", "[手順]"]], tableMeta: { a: {} } }).ok).toBe(true);
  });

  const ok = { format: "graphium-template", version: 1, title: "T", template: { blocks: [] } };
  it("JSON でない・別の形式・新しすぎる版・必須項目の欠けを理由つきで断る", () => {
    expect(parseTemplateFile("not json")).toMatchObject({ ok: false, reason: "notJson" });
    expect(parseTemplateFile(JSON.stringify({ ...ok, format: "other" }))).toMatchObject({ ok: false, reason: "wrongFormat" });
    expect(parseTemplateFile("[]")).toMatchObject({ ok: false, reason: "wrongFormat" });
    expect(parseTemplateFile(JSON.stringify({ ...ok, version: 2 }))).toMatchObject({ ok: false, reason: "unsupportedVersion" });
    expect(parseTemplateFile(JSON.stringify({ ...ok, version: "1" }))).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseTemplateFile(JSON.stringify({ ...ok, title: " " }))).toMatchObject({ ok: false, reason: "invalid", detail: "title" });
    expect(parseTemplateFile(JSON.stringify({ ...ok, template: {} }))).toMatchObject({ ok: false, reason: "invalid", detail: "template" });
    expect(parseTemplateFile(JSON.stringify({ ...ok, media: [{ hash: "h" }] }))).toMatchObject({ ok: false, reason: "invalid", detail: "media" });
  });
  it("最小の形でも読め、足りない配列は補う", () => {
    const r = parseTemplateFile(JSON.stringify(ok));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.template.labels).toEqual([]);
      expect(r.file.template.attributes).toEqual([]);
      expect(r.file.template.name).toBe("T");
    }
  });
});
