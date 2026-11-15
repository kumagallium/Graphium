// LocalFolderSharedProvider / LocalFolderBlobProvider のテスト。
// Tauri の invoke をモックしてインメモリ FS をシミュレートする。

import { describe, it, expect, beforeEach, vi } from "vitest";

// invoke モック（vi.hoisted で先に評価し、@tauri-apps/api/core の mock 内から参照する）
const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  LocalFolderSharedProvider,
  LocalFolderBlobProvider,
  AuthorMismatchError,
} from "./local-folder";
import type { SharedEntry } from "./types";
import { newSharedId } from "./id";
import { computeSharedEntryHash, computeBlobHash } from "./hash";
import type { AuthorIdentity } from "../../../features/document-provenance/types";

const author: AuthorIdentity = { name: "Ada", email: "a@b.co" };

/** インメモリ FS シミュレーション。各 invoke 呼び出しをハンドルする。 */
class FakeFs {
  /** key = `${entryType}/${id}` → JSON 文字列 */
  entries = new Map<string, string>();
  /** key = hash → base64 */
  blobs = new Map<string, string>();
  /** key = id → JSON 文字列 */
  tombstones = new Map<string, string>();

  install() {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args: any) => {
      switch (cmd) {
        case "shared_list": {
          const prefix = `${args.entryType}/`;
          const out: string[] = [];
          for (const [k, v] of this.entries) {
            if (k.startsWith(prefix)) out.push(v);
          }
          return out;
        }
        case "shared_read": {
          const key = `${args.entryType}/${args.id}`;
          const v = this.entries.get(key);
          if (!v) throw new Error(`not found: ${key}`);
          return v;
        }
        case "shared_write": {
          this.entries.set(`${args.entryType}/${args.id}`, args.content);
          return null;
        }
        case "shared_delete": {
          this.entries.delete(`${args.entryType}/${args.id}`);
          this.tombstones.set(args.id, args.tombstoneContent);
          return null;
        }
        case "shared_blob_read": {
          const v = this.blobs.get(args.hash);
          if (!v) throw new Error(`blob not found: ${args.hash}`);
          return v;
        }
        case "shared_blob_write": {
          this.blobs.set(args.hash, args.contentBase64);
          return null;
        }
        case "shared_blob_exists": {
          return this.blobs.has(args.hash);
        }
        default:
          throw new Error(`unmocked invoke: ${cmd}`);
      }
    });
  }
}

let fs: FakeFs;

beforeEach(() => {
  fs = new FakeFs();
  fs.install();
});

function makeEntry(overrides: Partial<SharedEntry> = {}): SharedEntry {
  return {
    id: newSharedId(),
    type: "note",
    author,
    created_at: "2026-05-04T00:00:00Z",
    updated_at: "2026-05-04T00:00:00Z",
    hash: "",
    prov: { derived_from: [] },
    ...overrides,
  };
}

describe("LocalFolderSharedProvider — write / read", () => {
  it("write した entry を read で取り戻せる、hash は自動計算される", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: author.email });
    const entry = makeEntry();
    const body = new TextEncoder().encode("hello");

    await provider.write(entry, body);
    const got = await provider.read(entry.id);

    expect(got.entry.id).toBe(entry.id);
    expect(got.entry.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(new TextDecoder().decode(got.body)).toBe("hello");
  });

  it("write 時に呼び出し側の hash 値は無視され、再計算される", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: author.email });
    const entry = makeEntry({ hash: "sha256:fake" });
    const body = new TextEncoder().encode("payload");

    await provider.write(entry, body);
    const got = await provider.read(entry.id);
    const expected = await computeSharedEntryHash(
      { ...entry, hash: expect.anything() as unknown as string },
      body,
    );
    // entry.hash は再計算後の値、 "sha256:fake" ではない
    expect(got.entry.hash).not.toBe("sha256:fake");
    expect(got.entry.hash).toBe(expected);
  });

  it("verifyHash は書き込み時に成功する", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: author.email });
    const entry = makeEntry();
    await provider.write(entry, new TextEncoder().encode("body"));
    expect(await provider.verifyHash(entry.id)).toBe(true);
  });

  it("verifyHash は本体改ざん時に失敗する", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: author.email });
    const entry = makeEntry();
    await provider.write(entry, new TextEncoder().encode("body"));
    // ファイル本体を不正に書き換え（hash は元のまま、body だけ変える）
    const key = `notes/${entry.id}`;
    const stored = JSON.parse(fs.entries.get(key)!);
    stored.body_base64 = btoa("tampered");
    fs.entries.set(key, JSON.stringify(stored));

    expect(await provider.verifyHash(entry.id)).toBe(false);
  });

  it("不正な id は弾く", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: author.email });
    await expect(provider.read("not-a-uuid")).rejects.toThrow(/Invalid shared id/);
  });
});

describe("LocalFolderSharedProvider — list", () => {
  it("type ごとに分離して列挙する", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: author.email });
    const note = makeEntry({ type: "note" });
    const ref = makeEntry({ type: "reference" });
    await provider.write(note, new TextEncoder().encode("n"));
    await provider.write(ref, new TextEncoder().encode("r"));

    const notes = await provider.list("note");
    const refs = await provider.list("reference");
    expect(notes.map((e) => e.id)).toEqual([note.id]);
    expect(refs.map((e) => e.id)).toEqual([ref.id]);
  });

  it("status='unshared' (tombstone) は list から除外される", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: author.email });
    const a = makeEntry();
    const b = makeEntry();
    await provider.write(a, new TextEncoder().encode("a"));
    await provider.write(b, new TextEncoder().encode("b"));
    await provider.delete(a.id);

    const listed = await provider.list("note");
    expect(listed.map((e) => e.id)).toEqual([b.id]);
  });
});

describe("LocalFolderSharedProvider — delete (tombstone)", () => {
  it("delete で本体は消え、tombstone が作られる", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: author.email });
    const entry = makeEntry();
    await provider.write(entry, new TextEncoder().encode("x"));
    await provider.delete(entry.id);

    expect(fs.entries.has(`notes/${entry.id}`)).toBe(false);
    expect(fs.tombstones.has(entry.id)).toBe(true);
    const tomb = JSON.parse(fs.tombstones.get(entry.id)!);
    expect(tomb.entry.status).toBe("unshared");
    expect(tomb.entry.unshared_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(tomb.body_base64).toBe("");
  });
});

describe("constructor validation", () => {
  it("空 root は弾く", () => {
    expect(() => new LocalFolderSharedProvider("")).toThrow();
    expect(() => new LocalFolderSharedProvider("   ")).toThrow();
    expect(() => new LocalFolderBlobProvider("")).toThrow();
  });
});

describe("LocalFolderBlobProvider", () => {
  it("put → get で同一 bytes を返す", async () => {
    const blobProv = new LocalFolderBlobProvider("/tmp/blobs");
    const bytes = new TextEncoder().encode("blob payload");
    const ref = await blobProv.put(bytes, { filename: "x.txt" });

    expect(ref.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(ref.filename).toBe("x.txt");
    expect(ref.size).toBe(bytes.length);
    expect(ref.uri).toBe(`local-folder://${ref.hash}`);

    const got = await blobProv.get(ref);
    expect(new TextDecoder().decode(got)).toBe("blob payload");
  });

  it("verifyHash は成功する", async () => {
    const blobProv = new LocalFolderBlobProvider("/tmp/blobs");
    const ref = await blobProv.put(new TextEncoder().encode("x"));
    expect(await blobProv.verifyHash(ref)).toBe(true);
  });

  it("verifyHash は改ざんを検知する", async () => {
    const blobProv = new LocalFolderBlobProvider("/tmp/blobs");
    const ref = await blobProv.put(new TextEncoder().encode("original"));
    // 同じ hash key で別 base64 を上書き（実環境ではコンテンツアドレッシングで起きないが防御確認）
    fs.blobs.set(ref.hash, btoa("tampered"));
    expect(await blobProv.verifyHash(ref)).toBe(false);
  });

  it("exists は put 後に true", async () => {
    const blobProv = new LocalFolderBlobProvider("/tmp/blobs");
    const bytes = new TextEncoder().encode("y");
    const hash = await computeBlobHash(bytes);
    expect(await blobProv.exists(hash)).toBe(false);
    await blobProv.put(bytes);
    expect(await blobProv.exists(hash)).toBe(true);
  });
});

describe("LocalFolderSharedProvider — author-owned enforcement", () => {
  const ada: AuthorIdentity = author; // 既に { name: "Ada", email: "a@b.co" }
  const mallory: AuthorIdentity = { name: "Mallory", email: "m@x.co" };

  it("identity 未指定で write を呼ぶと拒否される", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared");
    const entry = makeEntry({ author: ada });
    await expect(
      provider.write(entry, new TextEncoder().encode("x")),
    ).rejects.toThrow(/identity for write/);
  });

  it("identity 未指定で delete を呼ぶと拒否される", async () => {
    // 先に Ada として書き込んでおく
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: ada.email });
    const entry = makeEntry({ author: ada });
    await provider.write(entry, new TextEncoder().encode("x"));
    // identity なしで delete
    const noIdentity = new LocalFolderSharedProvider("/tmp/shared");
    await expect(noIdentity.delete(entry.id)).rejects.toThrow(/identity for write/);
  });

  it("自分の shared を更新（同 author）するのは成功する", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: ada.email });
    const entry = makeEntry({ author: ada });
    await provider.write(entry, new TextEncoder().encode("v1"));
    await provider.write(entry, new TextEncoder().encode("v2")); // 上書き OK
    const got = await provider.read(entry.id);
    expect(new TextDecoder().decode(got.body)).toBe("v2");
  });

  it("他人の shared を上書きしようとすると AuthorMismatchError", async () => {
    // Ada が書いた shared を Mallory が上書きしようとする
    const adaProv = new LocalFolderSharedProvider("/tmp/shared", { email: ada.email });
    const entry = makeEntry({ author: ada });
    await adaProv.write(entry, new TextEncoder().encode("ada-version"));

    const malloryProv = new LocalFolderSharedProvider("/tmp/shared", { email: mallory.email });
    await expect(
      malloryProv.write(
        { ...entry, author: mallory },
        new TextEncoder().encode("mallory-version"),
      ),
    ).rejects.toThrow(/Read-only/);

    // 中身が書き換わっていないことも確認
    const after = await adaProv.read(entry.id);
    expect(new TextDecoder().decode(after.body)).toBe("ada-version");
  });

  it("entry.author と identity が一致しないと write できない（自分名義以外で書けない）", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: ada.email });
    const entry = makeEntry({ author: mallory }); // identity=ada だが entry author は mallory
    await expect(
      provider.write(entry, new TextEncoder().encode("x")),
    ).rejects.toThrow(/does not match the current identity/);
  });

  it("他人の shared を delete しようとすると AuthorMismatchError", async () => {
    const adaProv = new LocalFolderSharedProvider("/tmp/shared", { email: ada.email });
    const entry = makeEntry({ author: ada });
    await adaProv.write(entry, new TextEncoder().encode("x"));

    const malloryProv = new LocalFolderSharedProvider("/tmp/shared", { email: mallory.email });
    await expect(malloryProv.delete(entry.id)).rejects.toThrow(/Read-only/);
    // tombstone は作られず、本体も残っている
    expect(fs.tombstones.has(entry.id)).toBe(false);
    expect(fs.entries.has(`notes/${entry.id}`)).toBe(true);
  });

  it("AuthorMismatchError は entryId / 両者の email を持つ", async () => {
    const adaProv = new LocalFolderSharedProvider("/tmp/shared", { email: ada.email });
    const entry = makeEntry({ author: ada });
    await adaProv.write(entry, new TextEncoder().encode("x"));

    const malloryProv = new LocalFolderSharedProvider("/tmp/shared", { email: mallory.email });
    try {
      await malloryProv.delete(entry.id);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthorMismatchError);
      const ame = e as AuthorMismatchError;
      expect(ame.entryId).toBe(entry.id);
      expect(ame.entryAuthorEmail).toBe(ada.email);
      expect(ame.callerEmail).toBe(mallory.email);
    }
  });
});

describe("共有フォルダの読み込みの検証（すり替え・なりすまし）", () => {
  it("blob の get は、中身が ref.hash と違えば例外（すり替え）", async () => {
    const blobProv = new LocalFolderBlobProvider("/tmp/blobs");
    const ref = await blobProv.put(new TextEncoder().encode("original"));
    fs.blobs.set(ref.hash, btoa("tampered"));
    await expect(blobProv.get(ref)).rejects.toThrow(/hash mismatch/);
    await expect(blobProv.url(ref)).rejects.toThrow(/hash mismatch/);
  });

  it("list は競合コピー（同じ中身の複製）があっても本物を 1 件だけ返す", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: author.email });
    const entry = makeEntry();
    await provider.write(entry, new TextEncoder().encode("本物"));
    const key = [...fs.entries.keys()].find((k) => k.endsWith(entry.id))!;
    // 別名のファイル（競合コピー）に同じ中身を置く
    fs.entries.set(key.replace(entry.id, "0194aaaa-0000-7000-8000-000000000000"), fs.entries.get(key)!);
    const other = makeEntry();
    await provider.write(other, new TextEncoder().encode("無関係"));
    const ids = (await provider.list("note")).map((e) => e.id).sort();
    expect(ids).toEqual([entry.id, other.id].sort());
  });

  it("list は同じ id を名乗る別内容の影を捨て、ファイル名が id の本物を残す", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: author.email });
    const entry = makeEntry();
    await provider.write(entry, new TextEncoder().encode("本物"));
    const key = [...fs.entries.keys()].find((k) => k.endsWith(entry.id))!;
    const shadow = JSON.parse(fs.entries.get(key)!);
    shadow.body_base64 = btoa("tampered");
    fs.entries.set(key.replace(entry.id, "0194aaaa-0000-7000-8000-000000000000"), JSON.stringify(shadow));
    const list = await provider.list("note");
    expect(list.map((e) => e.id)).toEqual([entry.id]);
  });

  it("list は本物が unshared（tombstone）のとき、同じ id を名乗る active な影を出さない", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: author.email });
    const entry = makeEntry();
    await provider.write(entry, new TextEncoder().encode("本物"));
    const key = [...fs.entries.keys()].find((k) => k.endsWith(entry.id))!;
    const active = fs.entries.get(key)!;
    const tomb = JSON.parse(active);
    tomb.entry.status = "unshared";
    fs.entries.set(key, JSON.stringify(tomb));
    fs.entries.set(key.replace(entry.id, "0194aaaa-0000-7000-8000-000000000000"), active);
    expect(await provider.list("note")).toEqual([]);
  });

  it("list は本物のファイルが無いまま同じ id が並ぶものを全部捨てる", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: author.email });
    const entry = makeEntry();
    await provider.write(entry, new TextEncoder().encode("x"));
    const key = [...fs.entries.keys()].find((k) => k.endsWith(entry.id))!;
    const json = fs.entries.get(key)!;
    fs.entries.delete(key);
    fs.entries.set(key.replace(entry.id, "0194aaaa-0000-7000-8000-000000000000"), json);
    fs.entries.set(key.replace(entry.id, "0194bbbb-0000-7000-8000-000000000000"), json);
    expect(await provider.list("note")).toEqual([]);
  });

  it("list は uuidv7 でない id の entry を捨てる", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: author.email });
    const entry = makeEntry();
    await provider.write(entry, new TextEncoder().encode("x"));
    const key = [...fs.entries.keys()].find((k) => k.endsWith(entry.id))!;
    const stored = JSON.parse(fs.entries.get(key)!);
    stored.entry.id = "../../etc/passwd";
    fs.entries.set(key, JSON.stringify(stored));
    expect(await provider.list("note")).toEqual([]);
  });

  it("read は、ファイル名の id と中身の id が違うものを断る", async () => {
    const provider = new LocalFolderSharedProvider("/tmp/shared", { email: author.email });
    const entry = makeEntry();
    await provider.write(entry, new TextEncoder().encode("x"));
    const key = [...fs.entries.keys()].find((k) => k.endsWith(entry.id))!;
    const stored = JSON.parse(fs.entries.get(key)!);
    stored.entry.id = makeEntry().id;
    fs.entries.set(key, JSON.stringify(stored));
    await expect(provider.read(entry.id)).rejects.toThrow(/id mismatch/);
  });
});
