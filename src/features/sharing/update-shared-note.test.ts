// @vitest-environment jsdom
// 受け付け中の共有ノートの「順番に更新」の処理の層のテスト。
// Tauri invoke を、Rust（shared_write）の判定を真似たフェイクに差し替える。
// Rust 側の判定そのものは lib.rs のテストで確かめている。

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const saveForkBaseMock = vi.hoisted(() => vi.fn());
vi.mock("./fork-base", () => ({ saveForkBase: saveForkBaseMock }));

import {
  canUpdateSharedNote,
  restoreSharedVersion,
  setAcceptsUpdates,
  updateSharedNoteFromCopy,
} from "./update-shared-note";
import { shareNote } from "./share-note";
import { forkSharedNote } from "./fork-note";
import type { SharedEntry } from "../../lib/storage/shared";
import type { GraphiumDocument } from "../../lib/document-types";
import type { AuthorIdentity } from "../document-provenance/types";

const ROOT = "/tmp/shared";
const owner: AuthorIdentity = { name: "Ada", email: "ada@x.co" };
const bob: AuthorIdentity = { name: "Bob", email: "bob@x.co" };

class FakeFs {
  entries = new Map<string, string>();
  /** 前の版: key = `${id}/${name}` */
  versions = new Map<string, string>();
  writes: any[] = [];
  install() {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args: any) => {
      switch (cmd) {
        case "shared_write": {
          const key = `${args.entryType}/${args.id}`;
          const cur = this.entries.get(key);
          if (cur !== undefined) {
            const curEntry = JSON.parse(cur).entry;
            const next = JSON.parse(args.content).entry;
            // Rust と同じ: 作者以外は受け付け中のノートに、expectedHash 付きでだけ書ける
            if (curEntry.author.email !== args.authorEmail) {
              if (!curEntry.extra?.acceptsUpdates || args.expectedHash === undefined || next.author.email !== curEntry.author.email) {
                throw new Error("Read-only: shared entry author is x");
              }
            }
            if (args.expectedHash !== undefined && args.expectedHash !== curEntry.hash) {
              throw new Error(`SHARED_CONFLICT:${curEntry.hash}`);
            }
            if (curEntry.extra?.acceptsUpdates) {
              this.versions.set(`${args.id}/${String(this.versions.size).padStart(13, "0")}-${"a".repeat(16)}.json`, cur);
            }
          }
          this.writes.push(args);
          this.entries.set(key, args.content);
          return null;
        }
        case "shared_read": {
          const v = this.entries.get(`${args.entryType}/${args.id}`);
          if (!v) throw new Error("not found");
          return v;
        }
        case "shared_versions_list":
          return [...this.versions.keys()]
            .filter((k) => k.startsWith(`${args.id}/`))
            .map((k) => k.split("/")[1])
            .sort()
            .reverse();
        case "shared_version_read": {
          const v = this.versions.get(`${args.id}/${args.name}`);
          if (!v) throw new Error("not found");
          return v;
        }
        case "shared_conflict_copies":
          return [];
        case "shared_readable_sync":
          return null;
        default:
          throw new Error(`unmocked: ${cmd}`);
      }
    });
  }
  entry(id: string): SharedEntry {
    return JSON.parse(this.entries.get(`notes/${id}`)!).entry;
  }
  bodyDoc(id: string): GraphiumDocument {
    const stored = JSON.parse(this.entries.get(`notes/${id}`)!);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(stored.body_base64), (c) => c.charCodeAt(0))));
  }
}

const last = <T,>(a: T[]): T => a[a.length - 1];

let fs: FakeFs;
beforeEach(() => {
  localStorage.clear();
  fs = new FakeFs();
  fs.install();
  saveForkBaseMock.mockReset();
});

function makeDoc(text = "hi", overrides: Partial<GraphiumDocument> = {}): GraphiumDocument {
  return {
    version: 5,
    title: "Procedure",
    pages: [
      {
        id: "p1",
        title: "Procedure",
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text }] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-05-04T00:00:00Z",
    modifiedAt: "2026-05-04T00:00:00Z",
    ...overrides,
  };
}

/** 作者が共有し、受け付けを入れる。共有 id と作者側の doc を返す */
async function ownerShares(accepts: boolean) {
  const shared = await shareNote(makeDoc("v1", { noteContexts: ["lab"] as any }), { root: ROOT, author: owner });
  if (!shared.ok) throw new Error("share failed");
  const id = shared.doc.sharedRef!.id;
  if (accepts) {
    const r = await setAcceptsUpdates(id, true, { root: ROOT, author: owner });
    if (!r.ok) throw new Error("toggle failed");
  }
  return { id, ownerDoc: shared.doc };
}

/** Bob が写しを作る（題は「… (forked)」のまま、本文を編集して返す） */
async function bobForks(id: string, text = "v2") {
  const forked = await forkSharedNote(id, { root: ROOT });
  if (!forked.ok) throw new Error("fork failed");
  const doc: GraphiumDocument = {
    ...forked.doc,
    pages: [{ ...forked.doc.pages[0], blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text }] }] }] as any,
  };
  return doc;
}

describe("canUpdateSharedNote", () => {
  const base = { id: "i", type: "note", author: owner, created_at: "", updated_at: "", hash: "h", prov: { derived_from: [] } } as SharedEntry;
  it("受け付け中の note だけ true", () => {
    expect(canUpdateSharedNote({ ...base, extra: { acceptsUpdates: true } })).toBe(true);
    expect(canUpdateSharedNote({ ...base })).toBe(false);
    expect(canUpdateSharedNote({ ...base, extra: { acceptsUpdates: false } })).toBe(false);
    expect(canUpdateSharedNote({ ...base, extra: { acceptsUpdates: true }, status: "unshared" })).toBe(false);
    expect(canUpdateSharedNote({ ...base, type: "knowledge", extra: { acceptsUpdates: true } })).toBe(false);
  });
});

describe("setAcceptsUpdates", () => {
  it("作者が切り替えられ、本文は変わらない", async () => {
    const { id } = await ownerShares(false);
    const bodyBefore = JSON.stringify(fs.bodyDoc(id));
    const r = await setAcceptsUpdates(id, true, { root: ROOT, author: owner });
    expect(r.ok).toBe(true);
    expect(fs.entry(id).extra?.acceptsUpdates).toBe(true);
    expect(JSON.stringify(fs.bodyDoc(id))).toBe(bodyBefore);
    // 読んだ版を確かめて書いている
    expect(last(fs.writes).expectedHash).toMatch(/^sha256:/);
  });

  it("作者以外は切り替えられない", async () => {
    const { id } = await ownerShares(true);
    const r = await setAcceptsUpdates(id, false, { root: ROOT, author: bob });
    expect(r.ok).toBe(false);
    expect(fs.entry(id).extra?.acceptsUpdates).toBe(true);
  });
});

describe("updateSharedNoteFromCopy", () => {
  it("受け付けていないノートは断り、何も書かない", async () => {
    const { id } = await ownerShares(false);
    const doc = await bobForks(id);
    const writes = fs.writes.length;
    const r = await updateSharedNoteFromCopy(doc, { root: ROOT, author: bob });
    expect(r.ok).toBe(false);
    expect((r as any).conflict).not.toBe(true);
    expect(fs.writes.length).toBe(writes);
  });

  it("作者以外が更新でき、作者・作成日時・id は変わらず updatedBy が付く", async () => {
    const { id } = await ownerShares(true);
    const before = fs.entry(id);
    const doc = await bobForks(id, "v2");
    const r = await updateSharedNoteFromCopy(doc, { root: ROOT, author: bob, noteId: "local-1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = fs.entry(id);
    expect(after.author).toEqual(owner);
    expect(after.created_at).toBe(before.created_at);
    expect(after.id).toBe(id);
    expect(after.extra?.updatedBy).toEqual({ name: "Bob", email: "bob@x.co" });
    expect(after.extra?.acceptsUpdates).toBe(true);
    expect(after.hash).toBe(r.entry.hash);
    // contributor として書いている
    expect(last(fs.writes).authorEmail).toBe("bob@x.co");
    // 本文は更新され、手元の関係は外れている
    const body = fs.bodyDoc(id);
    expect(JSON.stringify(body.pages)).toContain("v2");
    expect(body.forkedFrom).toBeUndefined();
    expect(body.sharedRef).toBeUndefined();
    // 作者のフォルダ（noteContexts）は残る
    expect(body.noteContexts).toEqual(["lab"]);
    // 手元の doc の基準 hash と控えが新しくなる
    expect(r.doc.forkedFrom!.hash).toBe(after.hash);
    expect(saveForkBaseMock).toHaveBeenCalledTimes(1);
    expect(saveForkBaseMock.mock.calls[0][0]).toBe("local-1");
    expect(saveForkBaseMock.mock.calls[0][1].hash).toBe(after.hash);
    expect(JSON.parse(saveForkBaseMock.mock.calls[0][1].body).pages[0].blocks[0].content[0].text).toBe("v2");
  });

  it("題が「<共有の題> (forked)」のままなら共有の題を使う。変えていれば変えた題", async () => {
    const { id } = await ownerShares(true);
    const doc = await bobForks(id);
    expect(doc.title).toBe("Procedure (forked)");
    const r = await updateSharedNoteFromCopy(doc, { root: ROOT, author: bob });
    expect(r.ok).toBe(true);
    expect(fs.entry(id).extra?.title).toBe("Procedure");
    expect(fs.bodyDoc(id).title).toBe("Procedure");
    // 手元の題は変えない
    if (r.ok) expect(r.doc.title).toBe("Procedure (forked)");

    const doc2 = { ...(r as any).doc, title: "Procedure v2" } as GraphiumDocument;
    const r2 = await updateSharedNoteFromCopy(doc2, { root: ROOT, author: bob });
    expect(r2.ok).toBe(true);
    expect(fs.entry(id).extra?.title).toBe("Procedure v2");
  });

  it("先に更新されていたら書かず、衝突と今の hash を返す", async () => {
    const { id } = await ownerShares(true);
    const bobDoc = await bobForks(id, "bob");
    const carolDoc = await bobForks(id, "carol");
    const first = await updateSharedNoteFromCopy(carolDoc, { root: ROOT, author: { name: "Carol", email: "c@x.co" } });
    expect(first.ok).toBe(true);
    const writes = fs.writes.length;
    const r = await updateSharedNoteFromCopy(bobDoc, { root: ROOT, author: bob });
    expect(r).toEqual({ ok: false, conflict: true, currentHash: fs.entry(id).hash });
    expect(fs.writes.length).toBe(writes);
    expect(JSON.stringify(fs.bodyDoc(id).pages)).toContain("carol");
  });

  it("読んだあと・書く直前に更新されたときも、書く側の確認で衝突になる", async () => {
    const { id } = await ownerShares(true);
    const doc = await bobForks(id);
    // 読み取りだけ古い版を返し、書く時点で版が進んでいる状況
    const real = invokeMock.getMockImplementation()!;
    let reads = 0;
    invokeMock.mockImplementation(async (cmd: string, args: any) => {
      if (cmd === "shared_read" && reads++ === 0) return real(cmd, args);
      if (cmd === "shared_write") {
        const cur = JSON.parse(fs.entries.get(`notes/${id}`)!);
        cur.entry.hash = "sha256:moved";
        fs.entries.set(`notes/${id}`, JSON.stringify(cur));
      }
      return real(cmd, args);
    });
    const r = await updateSharedNoteFromCopy(doc, { root: ROOT, author: bob });
    expect(r).toEqual({ ok: false, conflict: true, currentHash: "sha256:moved" });
  });

  it("履歴の updated_by は、前の更新者（なければ作者）", async () => {
    const { id } = await ownerShares(true);
    const d1 = await bobForks(id, "v2");
    const r1 = await updateSharedNoteFromCopy(d1, { root: ROOT, author: bob });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const h1 = fs.entry(id).history!;
    expect(last(h1).updated_by).toEqual(owner); // 作者の版が上書きされた
    const r2 = await updateSharedNoteFromCopy(
      { ...r1.doc, title: "Procedure" },
      { root: ROOT, author: owner },
    );
    expect(r2.ok).toBe(true);
    const h2 = fs.entry(id).history!;
    expect(last(h2).updated_by).toEqual(bob); // Bob の版が上書きされた
    expect(fs.entry(id).extra?.updatedBy).toEqual({ name: "Ada", email: "ada@x.co" });
  });

  it("forkedFrom の無い doc は断る", async () => {
    const r = await updateSharedNoteFromCopy(makeDoc(), { root: ROOT, author: bob });
    expect(r.ok).toBe(false);
  });
});

describe("作者の再共有", () => {
  it("受け付け中なら expectedHash を渡し、受け付けのスイッチを保つ", async () => {
    const { id, ownerDoc } = await ownerShares(true);
    // setAcceptsUpdates で hash が動いているので、作者の手元の sharedRef.hash は古い
    const stale = await shareNote(makeDoc("v3", { sharedRef: ownerDoc.sharedRef }), { root: ROOT, author: owner });
    expect(stale.ok).toBe(false);
    expect((stale as any).conflict).toBe(true);
    expect((stale as any).currentHash).toBe(fs.entry(id).hash);
    // 今の hash を持っていれば通り、受け付けも保たれる
    const fresh = await shareNote(
      makeDoc("v3", { sharedRef: { ...ownerDoc.sharedRef!, hash: fs.entry(id).hash } }),
      { root: ROOT, author: owner },
    );
    expect(fresh.ok).toBe(true);
    expect(fs.entry(id).extra?.acceptsUpdates).toBe(true);
    expect(last(fs.writes).expectedHash).toBeDefined();
  });

  it("他の人が更新したあとの作者の再共有は衝突になり、上書きしない", async () => {
    const { id, ownerDoc } = await ownerShares(true);
    const doc = await bobForks(id, "bob");
    const upd = await updateSharedNoteFromCopy(doc, { root: ROOT, author: bob });
    expect(upd.ok).toBe(true);
    const r = await shareNote(makeDoc("mine", { sharedRef: { ...ownerDoc.sharedRef!, hash: fs.entry(id).hash.replace(/.$/, "0") } }), { root: ROOT, author: owner });
    expect((r as any).conflict).toBe(true);
    expect(JSON.stringify(fs.bodyDoc(id).pages)).toContain("bob");
  });

  it("受け付けていないノートの再共有は従来どおり（expectedHash なし）", async () => {
    const { id, ownerDoc } = await ownerShares(false);
    const r = await shareNote(makeDoc("v2", { sharedRef: ownerDoc.sharedRef }), { root: ROOT, author: owner });
    expect(r.ok).toBe(true);
    expect(last(fs.writes).expectedHash).toBeUndefined();
    expect(fs.entry(id).extra?.acceptsUpdates).toBeUndefined();
  });
});

describe("restoreSharedVersion", () => {
  it("前の版の本文を今の版として書き直し、前の版は消えない", async () => {
    const { id } = await ownerShares(true);
    const doc = await bobForks(id, "bad edit");
    const upd = await updateSharedNoteFromCopy(doc, { root: ROOT, author: bob });
    expect(upd.ok).toBe(true);
    const provider = await import("../../lib/storage/shared").then((m) => new m.LocalFolderSharedProvider(ROOT, owner));
    const names = await provider.listVersions(id);
    expect(names.length).toBeGreaterThan(0);
    const currentHash = fs.entry(id).hash;
    const r = await restoreSharedVersion(id, names[0], { root: ROOT, author: owner });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(fs.bodyDoc(id).pages)).toContain("v1");
    expect(last(fs.writes).expectedHash).toBe(currentHash);
    expect(fs.entry(id).author).toEqual(owner);
    expect(fs.entry(id).extra?.acceptsUpdates).toBe(true);
    expect(fs.entry(id).extra?.updatedBy).toEqual({ name: "Ada", email: "ada@x.co" });
    expect((await provider.listVersions(id)).length).toBeGreaterThanOrEqual(names.length);
  });

  it("読み込み後に更新されていたら書かない", async () => {
    const { id } = await ownerShares(true);
    const doc = await bobForks(id);
    await updateSharedNoteFromCopy(doc, { root: ROOT, author: bob });
    const name = last([...fs.versions.keys()]).split("/")[1];
    const real = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (cmd: string, args: any) => {
      if (cmd === "shared_write") {
        const cur = JSON.parse(fs.entries.get(`notes/${id}`)!);
        cur.entry.hash = "sha256:moved";
        fs.entries.set(`notes/${id}`, JSON.stringify(cur));
      }
      return real(cmd, args);
    });
    const r = await restoreSharedVersion(id, name, { root: ROOT, author: owner });
    expect(r).toEqual({ ok: false, conflict: true, currentHash: "sha256:moved" });
  });
});
