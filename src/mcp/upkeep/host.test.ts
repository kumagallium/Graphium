import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GraphiumDocument } from "../../lib/document-types";
import { createMcpMaintenanceHost } from "./host";

let root: string;
const doc = (title: string) =>
  ({ version: 1, title, modifiedAt: "2026-10-01T00:00:00.000Z", pages: [{ id: "p", title, labels: {}, provLinks: [], knowledgeLinks: [], blocks: [{ id: "b", type: "paragraph", content: [{ type: "text", text: title, styles: {} }], children: [] }] }], wikiMeta: { kind: "topic" } }) as unknown as GraphiumDocument;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "host-"));
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, "appdata"), { recursive: true });
  writeFileSync(join(root, "wiki", "w1.json"), JSON.stringify(doc("元")));
  writeFileSync(join(root, "appdata", "note-index.json"), JSON.stringify({ version: 30, updatedAt: "x", notes: [] }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("createMcpMaintenanceHost", () => {
  it("保存・フラグ・読み出しが fs に効く", async () => {
    const host = createMcpMaintenanceHost(root);
    expect((await host.loadWikiDocFresh("w1"))?.title).toBe("元");
    expect(host.getIndexFlags("w1")).toBeNull();

    expect(await host.saveWikiFile("w1", doc("新"))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, "wiki", "w1.json"), "utf8")).title).toBe("新");
    expect(host.getIndexFlags("w1")).toEqual({ deletedAt: null, archivedAt: null });

    await host.archiveWiki("w1");
    expect(host.getIndexFlags("w1")?.archivedAt).toBeTruthy();
    await host.restoreWikiFlag("w1", "archivedAt");
    expect(host.getIndexFlags("w1")?.archivedAt).toBeNull();
    await host.trashWiki("w1");
    expect(host.getIndexFlags("w1")?.deletedAt).toBeTruthy();
    expect(host.isSaving?.()).toBe(false);
  });

  it("保存の例外は握って false を返す", async () => {
    const host = createMcpMaintenanceHost(root);
    // 索引を壊す → upsertEntry が throw
    writeFileSync(join(root, "appdata", "note-index.json"), "{oops");
    expect(await host.saveWikiFile("w1", doc("新"))).toBe(false);
  });

  it("activityType 付きの保存は編集の記録を足す", async () => {
    const host = createMcpMaintenanceHost(root);
    await host.saveWikiFile("w1", doc("新"), { activityType: "wiki_regenerate", agentLabel: "graphium-mcp (c)", sources: ["n1"] });
    const saved = JSON.parse(readFileSync(join(root, "wiki", "w1.json"), "utf8"));
    expect(saved.documentProvenance.activities.length).toBeGreaterThan(0);
  });
});
