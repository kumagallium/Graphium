// shareProposal（変更の提案 §25）のテスト。share-note.test.ts と同じく Tauri invoke をモックする。
//
// ここで守りたいこと:
//   1. 封筒は proposal 種別で、元エントリへの結び付き（extra.target / prov.derived_from）を持つ
//   2. 基準版（base）は content-addressed な blob に置かれ、同じ版から出た提案は 1 個に畳まれる
//   3. 提案として共有した手元ノートの sharedRef は type "proposal"。更新は同じ id への上書き
//   4. 通常の共有として出したノートを提案に付け替えない（1 ノート = 1 封筒）

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  shareProposal,
  updateProposal,
  withdrawProposal,
  readProposalExtra,
  proposalEntriesFor,
  countProposalsByTarget,
  proposalStatus,
  type SharedProposalExtra,
} from "./share-proposal";
import { shareNote } from "./share-note";
import { newSharedId, type SharedEntry } from "../../lib/storage/shared";
import type { GraphiumDocument } from "../../lib/document-types";
import type { AuthorIdentity } from "../document-provenance/types";

const author: AuthorIdentity = { name: "Ada", email: "a@b.co" };
const TARGET_ID = "0197b0a0-0000-7000-8000-000000000001";

class FakeFs {
  entries = new Map<string, string>(); // "folder/id" → StoredEntry JSON
  blobs = new Map<string, string>(); // hash → base64

  install() {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args: any) => {
      switch (cmd) {
        case "shared_write":
          this.entries.set(`${args.entryType}/${args.id}`, args.content);
          return null;
        case "shared_read": {
          const v = this.entries.get(`${args.entryType}/${args.id}`);
          if (!v) throw new Error("not found");
          return v;
        }
        case "shared_delete":
          this.entries.set(`${args.entryType}/${args.id}`, args.tombstoneContent);
          return null;
        case "shared_list": {
          const out: string[] = [];
          for (const [key, value] of this.entries) {
            if (key.startsWith(`${args.entryType}/`)) out.push(value);
          }
          return out;
        }
        case "shared_blob_write":
          this.blobs.set(args.hash, args.contentBase64);
          return null;
        case "shared_blob_read": {
          const v = this.blobs.get(args.hash);
          if (!v) throw new Error("blob not found");
          return v;
        }
        case "shared_blob_delete":
          this.blobs.delete(args.hash);
          return null;
        case "shared_blob_exists":
          return this.blobs.has(args.hash);
        default:
          throw new Error(`unmocked: ${cmd}`);
      }
    });
  }

  /** base64 → UTF-8 文字列（日本語の本文が化けないよう TextDecoder を通す） */
  static decode(b64: string): string {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /** 書き込まれた提案の封筒を読む */
  proposal(id: string): SharedEntry {
    const stored = this.entries.get(`proposals/${id}`);
    if (!stored) throw new Error(`proposal not written: ${id}`);
    return JSON.parse(stored).entry as SharedEntry;
  }

  /** 書き込まれた提案の本文（GraphiumDocument JSON） */
  proposalBody(id: string): string {
    const stored = this.entries.get(`proposals/${id}`);
    if (!stored) throw new Error(`proposal not written: ${id}`);
    return FakeFs.decode(JSON.parse(stored).body_base64);
  }
}

let fs: FakeFs;
beforeEach(() => {
  fs = new FakeFs();
  fs.install();
});

function makeDoc(overrides: Partial<GraphiumDocument> = {}): GraphiumDocument {
  return {
    version: 5,
    title: "測定手順 (forked)",
    pages: [
      {
        id: "p1",
        title: "測定手順 (forked)",
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "12.4 g" }] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    forkedFrom: {
      sharedId: TARGET_ID,
      hash: "sha256:" + "1".repeat(64),
      authorName: "Sensei",
      authorEmail: "s@b.co",
      forkedAt: "2026-09-01T00:00:00Z",
    },
    createdAt: "2026-09-01T00:00:00Z",
    modifiedAt: "2026-09-02T00:00:00Z",
    ...overrides,
  };
}

const options = { root: "/tmp/shared", author, blobRoot: "/tmp/blobs" };
const input = {
  target: TARGET_ID,
  targetHash: "sha256:" + "1".repeat(64),
  targetTitle: "測定手順",
  message: "3 検体ぶんの値を入れました",
};

const extraOf = (entry: SharedEntry) => entry.extra as unknown as SharedProposalExtra;

describe("shareProposal — 初回", () => {
  it("proposal 種別の封筒を書き、元エントリへの結び付きを持つ", async () => {
    const result = await shareProposal(makeDoc(), input, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entry = fs.proposal(result.entry.id);
    expect(entry.type).toBe("proposal");
    expect(entry.author.email).toBe("a@b.co");
    // 系譜は元エントリ 1 本（コメントと同じ作法）
    expect(entry.prov.derived_from).toEqual([TARGET_ID]);

    const extra = extraOf(entry);
    expect(extra.title).toBe("測定手順 (forked)");
    expect(extra.target).toBe(TARGET_ID);
    expect(extra.targetHash).toBe(input.targetHash);
    expect(extra.targetTitle).toBe("測定手順");
    expect(extra.message).toBe("3 検体ぶんの値を入れました");
  });

  it("本文は提案ノートの GraphiumDocument JSON", async () => {
    const result = await shareProposal(makeDoc(), input, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = JSON.parse(fs.proposalBody(result.entry.id)) as GraphiumDocument;
    expect(body.pages[0].blocks[0]).toMatchObject({ id: "b1" });
  });

  it("手元ノートの sharedRef は type proposal", async () => {
    const result = await shareProposal(makeDoc(), input, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isUpdate).toBe(false);
    expect(result.doc.sharedRef?.type).toBe("proposal");
    expect(result.doc.sharedRef?.id).toBe(result.entry.id);
    expect(result.doc.sharedRef?.hash).toBe(result.entry.hash);
  });

  it("元エントリ id が無ければ断る", async () => {
    const result = await shareProposal(makeDoc(), { ...input, target: "  " }, options);
    expect(result.ok).toBe(false);
  });

  it("通常の共有として出したノートは提案に付け替えない", async () => {
    const doc = makeDoc({
      sharedRef: { id: "x", type: "note", sharedAt: "2026-09-01T00:00:00Z", hash: "sha256:0" },
    });
    const result = await shareProposal(doc, input, options);
    expect(result.ok).toBe(false);
    // 元の封筒（notes/x）は触っていない
    expect(fs.entries.size).toBe(0);
  });
});

describe("shareNote 側の逆向きの守り", () => {
  it("提案として共有中のノートは通常の共有で上書きされない", async () => {
    const proposed = await shareProposal(makeDoc(), input, options);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const before = fs.proposal(proposed.entry.id).hash;

    const result = await shareNote(proposed.doc, options);
    expect(result.ok).toBe(false);
    // 提案の封筒は無傷（notes/ に同じ id が生まれていない）
    expect(fs.proposal(proposed.entry.id).hash).toBe(before);
    expect(fs.entries.has(`notes/${proposed.entry.id}`)).toBe(false);
  });
});

describe("shareProposal — 基準版（base）", () => {
  const base = JSON.stringify({ version: 5, title: "測定手順", pages: [] });

  it("blob に置いて extra.baseRef を付ける", async () => {
    const result = await shareProposal(makeDoc(), { ...input, base }, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ref = extraOf(fs.proposal(result.entry.id)).baseRef;
    expect(ref).toBeDefined();
    expect(ref!.filename).toBe("base.json");
    expect(FakeFs.decode(fs.blobs.get(ref!.hash)!)).toBe(base);
  });

  it("同じ基準版から出た 2 つの提案は同じ blob を指す（content-addressed）", async () => {
    const a = await shareProposal(makeDoc(), { ...input, base }, options);
    const b = await shareProposal(makeDoc(), { ...input, base }, options);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const hashA = extraOf(fs.proposal(a.entry.id)).baseRef!.hash;
    const hashB = extraOf(fs.proposal(b.entry.id)).baseRef!.hash;
    expect(hashA).toBe(hashB);
    expect(fs.blobs.size).toBe(1);
  });

  it("blob root 未設定なら baseRef 無しで成立する（2 者比較に落ちる）", async () => {
    const result = await shareProposal(makeDoc(), { ...input, base }, {
      root: "/tmp/shared",
      author,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(extraOf(fs.proposal(result.entry.id)).baseRef).toBeUndefined();
  });

  it("base 未指定なら baseRef を付けない", async () => {
    const result = await shareProposal(makeDoc(), input, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(extraOf(fs.proposal(result.entry.id)).baseRef).toBeUndefined();
    expect(fs.blobs.size).toBe(0);
  });
});

describe("updateProposal — 同じ封筒に上書き", () => {
  it("id を変えず、history に旧 hash を 1 行積む", async () => {
    const first = await shareProposal(makeDoc(), input, options);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const edited: GraphiumDocument = {
      ...first.doc,
      pages: [
        {
          ...first.doc.pages[0],
          blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "12.8 g" }] }],
        },
      ],
    };
    const second = await updateProposal(edited, input, options);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.isUpdate).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(second.entry.hash).not.toBe(first.entry.hash);
    const stored = fs.proposal(second.entry.id);
    expect(stored.history?.length).toBe(1);
    expect(stored.history?.[0].hash).toBe(first.entry.hash);
  });

  it("まだ提案として共有していないノートは断る", async () => {
    const result = await updateProposal(makeDoc(), input, options);
    expect(result.ok).toBe(false);
  });
});

describe("withdrawProposal", () => {
  it("tombstone 化する（既存の共有解除と同じ経路）", async () => {
    const shared = await shareProposal(makeDoc(), input, options);
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;
    const result = await withdrawProposal(shared.entry.id, options);
    expect(result.ok).toBe(true);
    expect(fs.proposal(shared.entry.id).status).toBe("unshared");
  });
});

// ── 純関数（封筒だけで数える・状態を導く） ──

function proposalEntry(
  target: string,
  overrides: Partial<SharedProposalExtra> = {},
  entryOverrides: Partial<SharedEntry> = {},
): SharedEntry {
  return {
    id: newSharedId(),
    type: "proposal",
    author,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    hash: "sha256:" + "a".repeat(64),
    prov: { derived_from: [target] },
    extra: {
      title: "提案",
      target,
      targetHash: "sha256:" + "1".repeat(64),
      targetTitle: "測定手順",
      ...overrides,
    } as unknown as Record<string, unknown>,
    ...entryOverrides,
  };
}

function noteEntry(id: string, overrides: Partial<SharedEntry> = {}): SharedEntry {
  return {
    id,
    type: "note",
    author: { name: "Sensei", email: "s@b.co" },
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    hash: "sha256:" + "1".repeat(64),
    prov: { derived_from: [] },
    extra: { title: "測定手順" },
    ...overrides,
  };
}

describe("readProposalExtra", () => {
  it("target を持たない封筒は提案として扱わない", () => {
    const broken = proposalEntry(TARGET_ID);
    broken.extra = { title: "壊れた提案" };
    expect(readProposalExtra(broken)).toBeNull();
  });

  it("proposal 以外の種別は読まない", () => {
    expect(readProposalExtra(noteEntry(TARGET_ID))).toBeNull();
  });
});

describe("proposalEntriesFor / countProposalsByTarget", () => {
  const entries = [
    noteEntry(TARGET_ID),
    proposalEntry(TARGET_ID),
    proposalEntry(TARGET_ID),
    proposalEntry("other-target"),
  ];

  it("元エントリに付いた提案だけを取り出す", () => {
    expect(proposalEntriesFor(TARGET_ID, entries)).toHaveLength(2);
    expect(proposalEntriesFor("", entries)).toEqual([]);
  });

  it("1 回の走査で対象ごとの件数表を作る", () => {
    const counts = countProposalsByTarget(entries);
    expect(counts.get(TARGET_ID)).toBe(2);
    expect(counts.get("other-target")).toBe(1);
    // ノートは数えない（提案の封筒だけ）
    expect(counts.size).toBe(2);
  });
});

describe("proposalStatus", () => {
  it("元エントリが同じ版のままなら受け付け中", () => {
    expect(proposalStatus(proposalEntry(TARGET_ID), noteEntry(TARGET_ID))).toBe("open");
  });

  it("元エントリがその後更新されていれば stale", () => {
    const target = noteEntry(TARGET_ID, { hash: "sha256:" + "2".repeat(64) });
    expect(proposalStatus(proposalEntry(TARGET_ID), target)).toBe("stale");
  });

  it("元エントリの adoptedProposals に載っていれば取り込み済み", () => {
    const proposal = proposalEntry(TARGET_ID);
    const target = noteEntry(TARGET_ID, {
      extra: { title: "測定手順", adoptedProposals: [proposal.id] },
    });
    expect(proposalStatus(proposal, target)).toBe("adopted");
  });

  it("取り込み済みは元がその後更新されていても取り込み済みのまま", () => {
    const proposal = proposalEntry(TARGET_ID);
    const target = noteEntry(TARGET_ID, {
      hash: "sha256:" + "2".repeat(64),
      extra: { title: "測定手順", adoptedProposals: [proposal.id] },
    });
    expect(proposalStatus(proposal, target)).toBe("adopted");
  });

  it("元エントリが無い / tombstone なら missing", () => {
    expect(proposalStatus(proposalEntry(TARGET_ID), null)).toBe("missing");
    const tombstoned = noteEntry(TARGET_ID, { status: "unshared" });
    expect(proposalStatus(proposalEntry(TARGET_ID), tombstoned)).toBe("missing");
  });

  it("target を渡さなければ一覧から元エントリを探す", () => {
    const proposal = proposalEntry(TARGET_ID);
    const entries = [noteEntry(TARGET_ID), proposal];
    expect(proposalStatus(proposal, null, entries)).toBe("open");
    expect(proposalStatus(proposal, null, [proposal])).toBe("missing");
  });
});
