// forkSharedNote のテスト。共有ノートの読み出しは Tauri invoke をモックする。
// 見るのは 2 点だけ:
//   - forkedFrom に出どころが記録される
//   - noteContexts（共有元のフォルダ）は引き継がない

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { forkSharedNote } from "./fork-note";
import { computeSharedEntryHash } from "../../lib/storage/shared/hash";
import type { SharedEntry } from "../../lib/storage/shared";
import type { GraphiumDocument } from "../../lib/document-types";

const ROOT = "/tmp/shared";
const SHARED_ID = "0195e000-0000-7000-8000-000000000001";

const sharedDoc = {
  version: 5,
  title: "焼結の手順",
  pages: [{ id: "p1", title: "焼結の手順", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
  noteContexts: ["卒論/焼結"],
  createdAt: "2026-05-04T00:00:00Z",
  modifiedAt: "2026-05-04T00:00:00Z",
} as unknown as GraphiumDocument;

/** provider.read が返す形（Rust 側の shared_read の戻り値と同じ JSON） */
async function installEntry(doc: GraphiumDocument): Promise<void> {
  const body = new TextEncoder().encode(JSON.stringify(doc));
  const base: SharedEntry = {
    id: SHARED_ID,
    type: "note",
    author: { name: "Tanaka", email: "tanaka@example.com" },
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-04T00:00:00Z",
    hash: "",
    prov: { derived_from: [] },
    extra: { title: doc.title },
  };
  const entry = { ...base, hash: await computeSharedEntryHash(base, body) };
  // provider が読む形（Rust の shared_read が返す JSON）
  const stored = JSON.stringify({ entry, body_base64: btoa(String.fromCharCode(...body)) });
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "shared_read") return stored;
    throw new Error(`unmocked: ${cmd}`);
  });
}

beforeEach(async () => {
  await installEntry(sharedDoc);
});

describe("forkSharedNote", () => {
  it("forkedFrom に共有元が記録される", async () => {
    const r = await forkSharedNote(SHARED_ID, { root: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.forkedFrom?.sharedId).toBe(SHARED_ID);
    expect(r.doc.forkedFrom?.authorEmail).toBe("tanaka@example.com");
  });

  it("共有元のフォルダ（noteContexts）は引き継がない", async () => {
    const r = await forkSharedNote(SHARED_ID, { root: ROOT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.noteContexts).toBeUndefined();
  });
});
