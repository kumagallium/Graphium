// AI との会話の素材（conversation:<fileId>）を MCP から読む経路の回帰テスト。
// 一時 vault に素材の一覧と本文（media/<fileId>.txt）を置き、断る条件と窓の返し方を確かめる。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describeSource, resetMediaIndexCache } from "./sources";
import { conversationTextFile, getSourceText, resetSourceTextCache } from "./source-text";
import { mediaSourceId } from "./media-search";

const FILE_ID = "conv-claude-code-11111111-2222-4333-8444-555555555555";
const TITLE = "全粒粉は 2 割までにする";
const BODY =
  "この資料は、私（利用者）と AI（Claude Code）の会話の記録である。\n\n" +
  "- 私（09:00）: 全粒粉は 2 割までにする。3 割だと生地がだれたので\n";

describe("AI との会話の素材を MCP から読む", () => {
  let root: string;

  function writeMediaIndex(media: object[]) {
    mkdirSync(join(root, "appdata"), { recursive: true });
    writeFileSync(join(root, "appdata", "media-index.json"), JSON.stringify({ version: 1, media }));
    resetMediaIndexCache();
  }

  const entry = (fileId: string, type: string, name = TITLE) => ({
    fileId,
    name,
    type,
    mimeType: type === "conversation" ? "text/plain" : "application/pdf",
    url: type === "conversation" ? `conversation:${fileId}` : "",
    uploadedAt: "2026-01-01T00:00:00.000Z",
    usedIn: [],
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "graphium-mcp-conversation-"));
    mkdirSync(join(root, "notes"), { recursive: true });
    mkdirSync(join(root, "media"), { recursive: true });
    resetSourceTextCache();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("本文を窓で返す（題は素材の name）", async () => {
    writeFileSync(join(root, "media", `${FILE_ID}.txt`), BODY);
    writeMediaIndex([entry(FILE_ID, "conversation")]);
    const out = await getSourceText({ sourceId: `conversation:${FILE_ID}` }, root);
    expect(out).toContain(`# ${TITLE}`);
    expect(out).toContain(`sourceId: conversation:${FILE_ID}`);
    expect(out).toContain("全粒粉は 2 割までにする。3 割だと生地がだれたので");
    expect(out).toContain("ここが最後の窓です。");
  });

  it("一覧に載っていない id は UNKNOWN_SOURCE", async () => {
    writeFileSync(join(root, "media", `${FILE_ID}.txt`), BODY);
    writeMediaIndex([]);
    const out = await getSourceText({ sourceId: `conversation:${FILE_ID}` }, root);
    expect(out.startsWith("UNKNOWN_SOURCE")).toBe(true);
  });

  it("一覧では別の種類（pdf）の id は UNKNOWN_SOURCE", async () => {
    writeFileSync(join(root, "media", `${FILE_ID}.txt`), BODY);
    writeMediaIndex([entry(FILE_ID, "pdf")]);
    const out = await getSourceText({ sourceId: `conversation:${FILE_ID}` }, root);
    expect(out.startsWith("UNKNOWN_SOURCE")).toBe(true);
  });

  it(".txt が無い id は UNKNOWN_SOURCE", async () => {
    writeMediaIndex([entry(FILE_ID, "conversation")]);
    const out = await getSourceText({ sourceId: `conversation:${FILE_ID}` }, root);
    expect(out.startsWith("UNKNOWN_SOURCE")).toBe(true);
  });

  it("conversationTextFile は会話の素材 id の形でなければ null（.txt を置いても探さない）", () => {
    writeFileSync(join(root, "media", "preview_abc.txt"), "別の素材の原文");
    expect(conversationTextFile("../x", root)).toBeNull();
    expect(conversationTextFile("preview_abc", root)).toBeNull();
    writeFileSync(join(root, "media", `${FILE_ID}.txt`), BODY);
    expect(conversationTextFile(FILE_ID, root)).toBe(join(root, "media", `${FILE_ID}.txt`));
  });

  it("describeSource は kind conversation と題を返す", () => {
    writeMediaIndex([entry(FILE_ID, "conversation")]);
    expect(describeSource(`conversation:${FILE_ID}`, root)).toEqual({
      id: `conversation:${FILE_ID}`,
      kind: "conversation",
      title: TITLE,
    });
  });

  it("mediaSourceId は conversation:<fileId>", () => {
    expect(mediaSourceId({ type: "conversation", fileId: FILE_ID, url: `conversation:${FILE_ID}` })).toBe(
      `conversation:${FILE_ID}`,
    );
  });
});
