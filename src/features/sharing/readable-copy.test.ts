// @vitest-environment jsdom
// 読める写し（syncReadableCopy）のテスト。Tauri invoke をモックして渡す引数を確かめる。

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { syncReadableCopy, type SyncReadableCopyInput } from "./readable-copy";
import { createSharedFolder, setSharedFolders } from "../../lib/storage/shared/config";
import type { GraphiumDocument } from "../../lib/document-types";

const ROOT = "/Volumes/Lab/Shared";
const SHARED_ID = "0190f3a2-7b1c-7e4d-9a55-3c2f1b8d6e70";
const author = { name: "Ada Lovelace", email: "ada@example.com" };

function makeDoc(title = "実験メモ"): GraphiumDocument {
  return {
    version: 5,
    title,
    pages: [
      {
        id: "p1",
        title,
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "本文です" }] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-05-04T00:00:00Z",
    modifiedAt: "2026-05-04T00:00:00Z",
  } as unknown as GraphiumDocument;
}

function makeInput(over: Partial<SyncReadableCopyInput> = {}): SyncReadableCopyInput {
  const doc = makeDoc();
  return {
    root: ROOT,
    authorEmail: author.email,
    sharedId: SHARED_ID,
    title: doc.title,
    entryDoc: doc,
    provDoc: doc,
    author,
    context: { noteId: "note-1" },
    sharedAt: "2026-11-17T01:02:03.000Z",
    ...over,
  };
}

function enable(on: boolean) {
  setSharedFolders([{ ...createSharedFolder(ROOT), ...(on ? { readableCopies: true } : {}) }]);
}

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(null);
});

describe("syncReadableCopy", () => {
  it("スイッチが入っていると markdown と prov を付けて invoke する", async () => {
    enable(true);
    const r = await syncReadableCopy(makeInput());
    expect(r.status).toBe("written");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = invokeMock.mock.calls[0];
    expect(cmd).toBe("shared_readable_sync");
    expect(args.root).toBe(ROOT);
    expect(args.entryType).toBe("notes");
    expect(args.id).toBe(SHARED_ID);
    expect(args.title).toBe("実験メモ");
    expect(args.authorEmail).toBe(author.email);
    expect(args.entryHash).toBeNull(); // 作者は渡さない
    expect(args.markdown).toContain("# 実験メモ");
    expect(args.markdown).toContain("本文です");
    expect(typeof args.prov).toBe("string");
    expect(JSON.parse(args.prov)["@context"]).toBeDefined();
  });

  it("切だと markdown: null で呼ぶ（古い写しを消すため）", async () => {
    enable(false);
    const r = await syncReadableCopy(makeInput());
    expect(r.status).toBe("off");
    const args = invokeMock.mock.calls[0][1];
    expect(args.markdown).toBeNull();
    expect(args.prov).toBeNull();
  });

  it("共有フォルダが未登録でも切と同じ", async () => {
    const r = await syncReadableCopy(makeInput());
    expect(r.status).toBe("off");
    expect(invokeMock.mock.calls[0][1].markdown).toBeNull();
  });

  it("context が無いと切と同じ", async () => {
    enable(true);
    const r = await syncReadableCopy(makeInput({ context: undefined }));
    expect(r.status).toBe("off");
    expect(invokeMock.mock.calls[0][1].markdown).toBeNull();
  });

  it("invoke が失敗しても例外にならず failed を返す", async () => {
    enable(true);
    invokeMock.mockRejectedValue(new Error("disk full"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await syncReadableCopy(makeInput());
    expect(r.status).toBe("failed");
    expect(r.error).toContain("disk full");
    warn.mockRestore();
  });

  it("前付けが題の改行や引用符で崩れない", async () => {
    enable(true);
    const title = 'a"b\nc: d\n---\ninjected: yes';
    await syncReadableCopy(makeInput({ title }));
    const md: string = invokeMock.mock.calls[0][1].markdown;
    const lines = md.split("\n");
    expect(lines[0]).toBe("---");
    // 前付けは 5 行 + 閉じの --- で、次の --- は 7 行目
    expect(lines[6]).toBe("---");
    expect(lines.slice(1, 6).map((l) => l.split(":")[0])).toEqual([
      "title",
      "graphium_note_id",
      "graphium_shared_id",
      "author",
      "shared_at",
    ]);
    expect(lines[1]).toBe(`title: ${JSON.stringify(title)}`);
    expect(lines[4]).toBe('author: "Ada Lovelace"');
    expect(lines[5]).toBe('shared_at: "2026-11-17T01:02:03.000Z"');
  });

  it("メールアドレスが markdown と prov に入らない", async () => {
    enable(true);
    await syncReadableCopy(makeInput());
    const args = invokeMock.mock.calls[0][1];
    expect(args.markdown).not.toContain(author.email);
    expect(args.prov).not.toContain(author.email);
  });

  it("メモから引用したブロックがあっても、引用した時点のメモ本文とメモの id は prov に入らない", async () => {
    enable(true);
    // 引用ブロックの本文は、引用のあとで短く書き直してある。memoQuotes.quotedText には
    // 引用した時点のメモ本文がそのまま残っている（本文には無い文が入っている）
    const doc = makeDoc();
    doc.pages[0].blocks = [
      { id: "q1", type: "quote", content: [{ type: "text", text: "残した一文" }] },
    ] as unknown as GraphiumDocument["pages"][number]["blocks"];
    doc.pages[0].memoQuotes = {
      q1: { captureId: "cap_secret_1", quotedAt: "2026-11-01T00:00:00Z", quotedText: "残した一文。本文には書かなかった続き" },
    };
    await syncReadableCopy(makeInput({ entryDoc: doc, provDoc: doc }));
    const args = invokeMock.mock.calls[0][1];
    expect(args.markdown).toContain("残した一文");
    expect(args.prov).not.toContain("本文には書かなかった続き");
    expect(args.prov).not.toContain("cap_secret_1");
  });
});

// ── TS の前付け ↔ Rust の持ち主の確認（src-tauri/src/lib.rs の readable_md_is_owned）──
//
// Rust は、写しを消す・上書きする前に、md の前付けの 1 行 `graphium_shared_id: "<id>"` で
// 「この共有 id の写しか」を確かめる（名前の末尾 12 桁が同じだけの別の共有の写しを触らないため）。
// 行の書き方がずれると、題を変えて再共有したときに古い写しが消えずに残り、同じ名前への
// 置き直しは「別の共有の写しと名前が重なる」と断られる。両者はビルドが別なので、ソースを読んで突き合わせる。
describe("前付けの共有 id の行 ↔ Rust readable_md_is_owned", () => {
  it("Rust が探す行と、TS が書く行が同じ形である", async () => {
    // jsdom 環境では import.meta.url が file: でないので、リポジトリの根（vitest の作業フォルダ）から辿る
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const rs = readFileSync(join(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
    const m = /let want = format!\("((?:[^"\\]|\\.)*)"\);/.exec(rs);
    expect(m, "readable_md_is_owned の want が見つからない").toBeTruthy();
    // Rust の文字列リテラル（\" を " に、{id} を実際の id に）
    const want = m![1].replace(/\\"/g, '"').replace("{id}", SHARED_ID);

    enable(true);
    invokeMock.mockResolvedValue(undefined);
    await syncReadableCopy(makeInput());
    const calls = invokeMock.mock.calls;
    const markdown: string = calls[calls.length - 1][1].markdown;
    // Rust は先頭 12 行だけを見て、行全体が一致するものを探す
    const head = markdown.split("\n").slice(0, 12);
    expect(head).toContain(want);
  });
});
