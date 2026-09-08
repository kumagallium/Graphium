// 共有コメントのテスト。
//
// 検証の軸:
//   - 封筒の形（type / extra / prov.derived_from）と author-owned の失敗
//   - スレッドの組み立て（root → replies、作成日昇順、返信の返信は親に寄る）
//   - 版の分け方（targetHash が現在の hash と違えば「古い版へのコメント」）

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  commentEntriesFor,
  commentSummary,
  commentsFor,
  countCommentsByTarget,
  countCommentsFor,
  createComment,
  deleteComment,
  editComment,
  loadCommentTexts,
  splitByTargetVersion,
  type SharedCommentExtra,
} from "./shared-comments";
import type { SharedEntry } from "../../lib/storage/shared";
import type { AuthorIdentity } from "../document-provenance/types";

const teacher: AuthorIdentity = { name: "Sensei", email: "t@lab.jp" };
const student: AuthorIdentity = { name: "Gakusei", email: "s@lab.jp" };
const ROOT = "/tmp/shared-root";

/** shared_write / shared_read / shared_delete だけを持つ最小のフェイク FS */
class FakeFs {
  entries = new Map<string, string>();
  install() {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args: any) => {
      const key = `${args.entryType}/${args.id}`;
      switch (cmd) {
        case "shared_write":
          this.entries.set(key, args.content);
          return null;
        case "shared_read": {
          const v = this.entries.get(key);
          if (!v) throw new Error("not found");
          return v;
        }
        case "shared_delete":
          this.entries.set(key, args.tombstoneContent);
          return null;
        default:
          throw new Error(`unmocked: ${cmd}`);
      }
    });
  }
  /** 本体は latin1 base64（uint8ToBase64）なので、UTF-8 として読み直す */
  text(id: string): string {
    const b64 = this.stored(id).body_base64;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  stored(id: string): { entry: SharedEntry; body_base64: string } {
    const raw = this.entries.get(`comments/${id}`);
    if (!raw) throw new Error(`missing ${id}`);
    return JSON.parse(raw);
  }
}

let fs: FakeFs;
beforeEach(() => {
  fs = new FakeFs();
  fs.install();
});

const commentEntry = (
  id: string,
  createdAt: string,
  extra: SharedCommentExtra,
  author: AuthorIdentity = teacher,
): SharedEntry => ({
  id,
  type: "comment",
  author,
  created_at: createdAt,
  updated_at: createdAt,
  hash: `sha256:${id}`,
  prov: { derived_from: [extra.target] },
  extra: extra as unknown as Record<string, unknown>,
});

describe("createComment / editComment / deleteComment", () => {
  it("comments/ に type=comment の封筒を書き、extra に対象と抜粋を残す", async () => {
    const r = await createComment({
      root: ROOT,
      author: teacher,
      target: "target-1",
      targetHash: "sha256:v1",
      text: "この温度で本当に焼けましたか？",
      blockId: "b1",
      blockText: "800 ℃ で 2 時間焼成",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stored = fs.stored(r.entry.id);
    expect(stored.entry.type).toBe("comment");
    expect(stored.entry.prov.derived_from).toEqual(["target-1"]);
    expect(stored.entry.extra).toMatchObject({
      target: "target-1",
      targetHash: "sha256:v1",
      blockId: "b1",
      blockText: "800 ℃ で 2 時間焼成",
    });
    expect(fs.text(r.entry.id)).toContain("焼けました");
    // hash は provider が計算して入れる（空のままにしない）
    expect(stored.entry.hash).toMatch(/^sha256:/);
  });

  it("identity 未登録なら書けない", async () => {
    const r = await createComment({
      root: ROOT,
      author: { name: "", email: "" },
      target: "t",
      targetHash: "h",
      text: "x",
    });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("identity") });
  });

  it("空の本文は書かない", async () => {
    const r = await createComment({
      root: ROOT,
      author: teacher,
      target: "t",
      targetHash: "h",
      text: "   \n  ",
    });
    expect(r.ok).toBe(false);
  });

  it("編集は本文だけ差し替え、対象・段落・作成日は動かさない", async () => {
    const created = await createComment({
      root: ROOT,
      author: teacher,
      target: "target-1",
      targetHash: "sha256:v1",
      text: "初稿",
      blockId: "b1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.entry.id;
    const r = await editComment({ root: ROOT, author: teacher, id, text: "書き直し" });
    expect(r.ok).toBe(true);
    const stored = fs.stored(id);
    expect(fs.text(id)).toBe("書き直し");
    expect(stored.entry.created_at).toBe(created.entry.created_at);
    expect(stored.entry.extra).toMatchObject({ target: "target-1", blockId: "b1" });
  });

  it("他人のコメントは編集できない（author-owned）", async () => {
    const created = await createComment({
      root: ROOT,
      author: teacher,
      target: "target-1",
      targetHash: "sha256:v1",
      text: "指摘",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const r = await editComment({
      root: ROOT,
      author: student,
      id: created.entry.id,
      text: "勝手に書き換え",
    });
    expect(r.ok).toBe(false);
  });

  it("削除は tombstone（status=unshared）にする", async () => {
    const created = await createComment({
      root: ROOT,
      author: teacher,
      target: "target-1",
      targetHash: "sha256:v1",
      text: "指摘",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const r = await deleteComment({ root: ROOT, author: teacher, id: created.entry.id });
    expect(r.ok).toBe(true);
    expect(fs.stored(created.entry.id).entry.status).toBe("unshared");
  });
});

describe("commentsFor / splitByTargetVersion", () => {
  const base: SharedCommentExtra = { target: "n1", targetHash: "sha256:v2" };
  const entries: SharedEntry[] = [
    commentEntry("c-root", "2026-09-01T10:00:00Z", base),
    commentEntry("c-reply", "2026-09-01T11:00:00Z", { ...base, parentId: "c-root" }, student),
    // 返信への返信は root に寄る（1 段しか作らない）
    commentEntry("c-reply2", "2026-09-01T12:00:00Z", { ...base, parentId: "c-reply" }),
    // 古い版へのコメント
    commentEntry("c-old", "2026-08-01T10:00:00Z", { ...base, targetHash: "sha256:v1" }),
    // 別の対象・別の種別は混ざらない
    commentEntry("c-other", "2026-09-02T10:00:00Z", { target: "n2", targetHash: "sha256:x" }),
    {
      id: "note-1",
      type: "note",
      author: teacher,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      hash: "sha256:v2",
      prov: { derived_from: [] },
    },
  ];

  it("対象 id で絞り、root → replies（作成日昇順）に組み立てる", () => {
    const threads = commentsFor("n1", entries);
    expect(threads.map((t) => t.root.id)).toEqual(["c-old", "c-root"]);
    const main = threads.find((t) => t.root.id === "c-root")!;
    expect(main.replies.map((r) => r.id)).toEqual(["c-reply", "c-reply2"]);
    expect(main.replies[0].author.email).toBe(student.email);
  });

  it("本文の Map を渡すとテキストが載る（渡さなければ空）", () => {
    const texts = new Map([["c-root", "ここを直してください"]]);
    expect(commentsFor("n1", entries, texts).find((t) => t.root.id === "c-root")!.root.text).toBe(
      "ここを直してください",
    );
    expect(commentsFor("n1", entries).find((t) => t.root.id === "c-root")!.root.text).toBe("");
  });

  it("件数と封筒の抽出は type=comment かつ対象一致のみ", () => {
    expect(countCommentsFor("n1", entries)).toBe(4);
    expect(commentEntriesFor("n2", entries).map((e) => e.id)).toEqual(["c-other"]);
    expect(countCommentsFor("", entries)).toBe(0);
  });

  it("countCommentsByTarget は 1 回の走査で対象ごとの件数を返す（一覧の行はここから引く）", () => {
    const counts = countCommentsByTarget(entries);
    expect(counts.get("n1")).toBe(4);
    expect(counts.get("n2")).toBe(1);
    // コメント以外・対象の無い封筒は数えない（ノート id は鍵に現れない）
    expect(counts.has("note-1")).toBe(false);
    expect(counts.size).toBe(2);
    // 行ごとに数えた結果と一致する（置き換えで意味が変わっていないこと）
    for (const target of ["n1", "n2", "note-1"]) {
      expect(counts.get(target) ?? 0).toBe(countCommentsFor(target, entries));
    }
  });

  it("targetHash が現在の hash と違うスレッドは古い版に畳まれる", () => {
    const threads = commentsFor("n1", entries);
    const split = splitByTargetVersion(threads, "sha256:v2");
    expect(split.current.map((t) => t.root.id)).toEqual(["c-root"]);
    expect(split.older.map((t) => t.root.id)).toEqual(["c-old"]);
    // 返信は root に従う（同じ話を引き離さない）
    expect(split.current[0].replies).toHaveLength(2);
  });

  it("親が見つからない返信は落とさず単独のスレッドにする", () => {
    const orphan = [commentEntry("c-x", "2026-09-03T10:00:00Z", { ...base, parentId: "gone" })];
    expect(commentsFor("n1", orphan).map((t) => t.root.id)).toEqual(["c-x"]);
  });
});

describe("loadCommentTexts", () => {
  it("hash が合わない本文は空にする（改ざんされた指摘を見せない）", async () => {
    const entries = [
      commentEntry("c1", "2026-09-01T10:00:00Z", { target: "n1", targetHash: "h" }),
      commentEntry("c2", "2026-09-01T11:00:00Z", { target: "n1", targetHash: "h" }),
    ];
    const texts = await loadCommentTexts(entries, async (e) => ({
      body: new TextEncoder().encode(`body of ${e.id}`),
      verified: e.id === "c1",
    }));
    expect(texts.get("c1")).toBe("body of c1");
    expect(texts.get("c2")).toBe("");
  });
});

describe("commentSummary", () => {
  it("最初の空でない行を返す", () => {
    expect(commentSummary("\n\n  焼成温度の根拠は？  \n次の行")).toBe("焼成温度の根拠は？");
    expect(commentSummary("")).toBe("");
  });

  it("長い行は省略記号で切る", () => {
    expect(commentSummary("あ".repeat(200))).toBe(`${"あ".repeat(120)}…`);
  });
});
