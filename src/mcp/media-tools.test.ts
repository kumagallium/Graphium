// media-tools.ts（list_media / get_media_file / add_material の本体）の回帰テスト。一時 vault で回す。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetMediaIndexCache } from "./sources";
import {
  addMaterial,
  addedLedgerPath,
  findMediaDataFile,
  getMediaFile,
  listMedia,
  MAX_MEDIA_BYTES,
  mediaExt,
  readAddedLedger,
  validateMediaId,
} from "./media-tools";

function entry(over: Record<string, unknown>) {
  return { url: "", thumbnailUrl: "", uploadedAt: "2026-10-01T00:00:00Z", usedIn: [], mimeType: "", type: "data", ...over };
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

describe("media-tools", () => {
  let root: string;
  let media: string;

  function writeIndex(items: object[]) {
    writeFileSync(join(root, "appdata", "media-index.json"), JSON.stringify({ version: 1, media: items }));
    resetMediaIndexCache();
  }
  function writeBody(filename: string, content: string | Buffer) {
    writeFileSync(join(media, filename), content);
  }
  function writeMeta(id: string, name: string, mimeType: string) {
    writeFileSync(join(media, `${id}.meta.json`), JSON.stringify({ id, name, mimeType, createdTime: "2026-10-01T00:00:00Z" }));
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "graphium-mcp-media-tools-"));
    media = join(root, "media");
    mkdirSync(join(root, "notes"), { recursive: true });
    mkdirSync(join(root, "appdata"), { recursive: true });
    mkdirSync(media, { recursive: true });
    resetMediaIndexCache();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    resetMediaIndexCache();
  });

  // ── 一覧 ───────────────────────────────────────────────
  describe("listMedia", () => {
    it("ドット付きの exts で絞れ、大文字小文字を区別せず、新しい順に並び、size は実体から取る", () => {
      writeIndex([
        entry({ fileId: "a", name: "old.csv", uploadedAt: "2026-01-01T00:00:00Z" }),
        entry({ fileId: "b", name: "NEW.CSV", uploadedAt: "2026-03-01T00:00:00Z" }),
        entry({ fileId: "c", name: "mid.xlsx", type: "document", uploadedAt: "2026-02-01T00:00:00Z" }),
        entry({ fileId: "d", name: "photo.png", type: "image", uploadedAt: "2026-04-01T00:00:00Z" }),
      ]);
      writeBody("a.csv", "1,2\n");
      writeBody("b.csv", "1,2,3\n");
      const { items } = listMedia({ exts: [".csv", ".XLSX"] }, root);
      expect(items.map((i) => i.id)).toEqual(["b", "c", "a"]);
      expect(items[0].size).toBe(6);
      expect(items[2].size).toBe(4);
      expect(items[1].size).toBeUndefined(); // 実体が無ければ省く
    });

    it("exts のドット無しも受け、limit で切り、folder と type でも絞れる", () => {
      writeIndex([
        entry({ fileId: "a", name: "a.csv", uploadedAt: "2026-01-01T00:00:00Z", noteContexts: ["パン"] }),
        entry({ fileId: "b", name: "b.csv", uploadedAt: "2026-02-01T00:00:00Z" }),
        entry({ fileId: "c", name: "c.csv", uploadedAt: "2026-03-01T00:00:00Z", noteContexts: ["パン", "小麦"] }),
      ]);
      expect(listMedia({ exts: ["csv"], limit: 2 }, root).items.map((i) => i.id)).toEqual(["c", "b"]);
      const inFolder = listMedia({ folder: "パン" }, root).items;
      expect(inFolder.map((i) => i.id)).toEqual(["c", "a"]);
      expect(inFolder[0].folder).toBe("パン");
      expect(listMedia({ type: "image" }, root).items).toEqual([]);
    });

    it("アーカイブ済み・URL・メモは出ず、contentHash は索引の値を返す", () => {
      writeIndex([
        entry({ fileId: "a", name: "a.csv", contentHash: "sha256:aa" }),
        entry({ fileId: "b", name: "b.csv", archivedAt: "2026-05-01T00:00:00Z" }),
        entry({ fileId: "u", name: "page.csv", type: "url", url: "https://example.org/page.csv" }),
        entry({ fileId: "m", name: "memo.csv", type: "memo" }),
      ]);
      const { items } = listMedia({}, root);
      expect(items.map((i) => i.id)).toEqual(["a"]);
      expect(items[0].contentHash).toBe("sha256:aa");
    });

    it("vault が無ければ失敗する", () => {
      rmSync(join(root, "notes"), { recursive: true });
      expect(() => listMedia({}, root)).toThrow(/vault/);
    });
  });

  // ── 実体の探し方 ───────────────────────────────────────
  describe("findMediaDataFile", () => {
    it("新形式・.txt の原本（拡張子なし）・旧形式を引き、.tmp と付随ファイルを本体として拾わない", () => {
      writeBody("new1.csv", "x");
      writeMeta("new1", "new1.csv", "text/csv");
      writeBody("txt1", "原文の原本"); // .txt は予約なので拡張子なしで保存される
      writeBody("txt1.txt", "Reader 原文");
      writeMeta("txt1", "memo.txt", "text/plain");
      writeBody("old1", "旧形式");
      writeBody("tmp1.csv.tmp", "書きかけ");
      writeBody("tmp1.transcript.json", "{}");
      writeMeta("tmp1", "tmp1.csv", "text/csv");
      expect(findMediaDataFile(media, "new1")).toBe(join(media, "new1.csv"));
      expect(findMediaDataFile(media, "txt1")).toBe(join(media, "txt1"));
      expect(findMediaDataFile(media, "old1")).toBe(join(media, "old1"));
      expect(findMediaDataFile(media, "tmp1")).toBeNull();
      expect(findMediaDataFile(media, "none")).toBeNull();
      expect(findMediaDataFile(media, "")).toBeNull();
    });
  });

  // ── 取得 ───────────────────────────────────────────────
  describe("getMediaFile", () => {
    it("索引に無い id も media/ から返し、inline で中身が付く", async () => {
      writeBody("x1.csv", "a,b\n");
      writeMeta("x1", "price.csv", "text/csv");
      const r = await getMediaFile({ id: "x1", inline: true }, root);
      expect(r).toEqual({ id: "x1", name: "price.csv", mimeType: "text/csv", size: 4, bytes_base64: b64("a,b\n") });
      const noInline = await getMediaFile({ id: "x1" }, root);
      expect(noInline.bytes_base64).toBeUndefined();
    });

    it("アーカイブ済みでも id なら返し、meta が無ければ索引か名前から補う", async () => {
      writeIndex([entry({ fileId: "ar", name: "archived.csv", mimeType: "text/csv", archivedAt: "2026-05-01T00:00:00Z" })]);
      writeBody("ar.csv", "1\n");
      const r = await getMediaFile({ id: "ar" }, root);
      expect(r.name).toBe("archived.csv");
      expect(r.mimeType).toBe("text/csv");
      writeBody("bare.xlsx", "zz");
      const r2 = await getMediaFile({ id: "bare" }, root);
      expect(r2.name).toBe("bare.xlsx");
      expect(r2.mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    });

    it("../x・空・スラッシュ入り・NUL・先頭ドットの id を拒否する", async () => {
      for (const id of ["../x", "", "a/b", "a\\b", "a\0b", ".hidden", "..", "a..b"]) {
        await expect(getMediaFile({ id }, root)).rejects.toThrow(/id/);
      }
      expect(validateMediaId("ok-id_1")).toBeNull();
    });

    it("無い id は見つからないと返す", async () => {
      await expect(getMediaFile({ id: "nope" }, root)).rejects.toThrow(/見つかりません/);
    });
  });

  // ── 追加 ───────────────────────────────────────────────
  describe("addMaterial", () => {
    const csv = "name,price\nflour,120\n";

    it("追加すると <id>.<ext> と meta と台帳ができ、.tmp は残らない", async () => {
      const r = await addMaterial({ bytes_base64: b64(csv), name: "price.csv" }, root);
      expect(r.duplicate).toBe(false);
      expect(r.indexed).toBe(false);
      const names = readdirSync(media).sort();
      expect(names).toEqual([`${r.id}.csv`, `${r.id}.meta.json`]);
      expect(readFileSync(join(media, `${r.id}.csv`), "utf8")).toBe(csv);
      const meta = JSON.parse(readFileSync(join(media, `${r.id}.meta.json`), "utf8"));
      expect(meta).toMatchObject({ id: r.id, name: "price.csv", mimeType: "text/csv" });
      expect(typeof meta.createdTime).toBe("string");
      const ledger = readAddedLedger(root);
      const keys = Object.keys(ledger.added);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(ledger.added[keys[0]].fileId).toBe(r.id);
      expect(existsSync(join(root, "appdata", "mcp-write-lock.json"))).toBe(false);
    });

    it("同じ bytes の再追加は duplicate: true（別名でも合流）", async () => {
      const first = await addMaterial({ bytes_base64: b64(csv), name: "price.csv" }, root);
      const again = await addMaterial({ bytes_base64: b64(csv), name: "price.csv" }, root);
      const renamed = await addMaterial({ bytes_base64: b64(csv), name: "別名.csv", mimeType: "text/csv" }, root);
      expect(again).toEqual({ id: first.id, duplicate: true });
      expect(renamed).toEqual({ id: first.id, duplicate: true });
      expect(readdirSync(media)).toHaveLength(2);
    });

    it("索引の contentHash と一致すれば合流するが、索引でアーカイブ済みとは合流しない", async () => {
      const bytes = Buffer.from(csv, "utf8");
      const hash = await (await import("../lib/storage/shared/hash")).computeBlobHash(new Uint8Array(bytes));
      writeIndex([entry({ fileId: "app1", name: "price.csv", contentHash: hash })]);
      writeBody("app1.csv", csv);
      const r = await addMaterial({ bytes_base64: b64(csv), name: "price.csv" }, root);
      expect(r).toEqual({ id: "app1", duplicate: true });

      writeIndex([entry({ fileId: "app1", name: "price.csv", contentHash: hash, archivedAt: "2026-05-01T00:00:00Z" })]);
      const r2 = await addMaterial({ bytes_base64: b64(csv), name: "price.csv" }, root);
      expect(r2.duplicate).toBe(false);
      expect(r2.id).not.toBe("app1");
    });

    it("索引の contentHash が一致しても実体が無ければ合流しない", async () => {
      const bytes = Buffer.from(csv, "utf8");
      const hash = await (await import("../lib/storage/shared/hash")).computeBlobHash(new Uint8Array(bytes));
      writeIndex([entry({ fileId: "gone", name: "price.csv", contentHash: hash })]);
      const r = await addMaterial({ bytes_base64: b64(csv), name: "price.csv" }, root);
      expect(r.duplicate).toBe(false);
    });

    it("台帳にあるが本体が無い → 新規（台帳の行は差し替わる）", async () => {
      const first = await addMaterial({ bytes_base64: b64(csv), name: "price.csv" }, root);
      rmSync(join(media, `${first.id}.csv`));
      rmSync(join(media, `${first.id}.meta.json`));
      const r = await addMaterial({ bytes_base64: b64(csv), name: "price.csv" }, root);
      expect(r.duplicate).toBe(false);
      expect(r.id).not.toBe(first.id);
      const ledger = readAddedLedger(root);
      expect(Object.values(ledger.added).map((e) => e.fileId)).toEqual([r.id]);
    });

    it("台帳にあるが索引でアーカイブ済み → 新規", async () => {
      const first = await addMaterial({ bytes_base64: b64(csv), name: "price.csv" }, root);
      writeIndex([entry({ fileId: first.id, name: "price.csv", archivedAt: "2026-05-01T00:00:00Z" })]);
      const r = await addMaterial({ bytes_base64: b64(csv), name: "price.csv" }, root);
      expect(r.duplicate).toBe(false);
      expect(r.id).not.toBe(first.id);
    });

    it("壊れた台帳は空として扱い、追加後に書き直す", async () => {
      writeFileSync(addedLedgerPath(root), "{not json");
      const r = await addMaterial({ bytes_base64: b64(csv), name: "price.csv" }, root);
      expect(r.duplicate).toBe(false);
      expect(Object.keys(readAddedLedger(root).added)).toHaveLength(1);
    });

    it(".txt は予約なので拡張子なしで保存し、名前に拡張子が無ければ MIME から補う", async () => {
      const t = await addMaterial({ bytes_base64: b64("memo"), name: "memo.txt" }, root);
      expect(existsSync(join(media, t.id))).toBe(true);
      expect(existsSync(join(media, `${t.id}.txt`))).toBe(false);
      const got = await getMediaFile({ id: t.id, inline: true }, root);
      expect(got.name).toBe("memo.txt");
      expect(got.bytes_base64).toBe(b64("memo"));

      const p = await addMaterial({ bytes_base64: b64("%PDF"), name: "paper", mimeType: "application/pdf" }, root);
      expect(existsSync(join(media, `${p.id}.pdf`))).toBe(true);
      expect(mediaExt("a.CSV", "")).toBe("csv");
      expect(mediaExt("a.tar.gz", "")).toBe("gz");
      expect(mediaExt("a.verylongext", "")).toBeNull();
      expect(mediaExt("a.x-y", "")).toBeNull();
    });

    it("32 MiB 超を拒否する（復号前の長さでも、復号後の長さでも）", async () => {
      const tooLong = "A".repeat(Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 8);
      await expect(addMaterial({ bytes_base64: tooLong, name: "big.bin" }, root)).rejects.toThrow(/大きすぎます/);
      const justOver = Buffer.alloc(MAX_MEDIA_BYTES + 1).toString("base64");
      await expect(addMaterial({ bytes_base64: justOver, name: "big.bin" }, root)).rejects.toThrow(/大きすぎます/);
      expect(readdirSync(media)).toEqual([]);
    });

    it("path・folder・空の name・空や不正な bytes を拒否する", async () => {
      await expect(addMaterial({ bytes_base64: b64(csv), name: "a.csv", path: "/etc/passwd" }, root)).rejects.toThrow(/path/);
      await expect(addMaterial({ bytes_base64: b64(csv), name: "a.csv", folder: "パン" }, root)).rejects.toThrow(/folder/);
      await expect(addMaterial({ bytes_base64: b64(csv), name: "  " }, root)).rejects.toThrow(/name/);
      await expect(addMaterial({ bytes_base64: "", name: "a.csv" }, root)).rejects.toThrow(/bytes_base64/);
      await expect(addMaterial({ bytes_base64: "***", name: "a.csv" }, root)).rejects.toThrow(/base64/);
      expect(readdirSync(media)).toEqual([]);
      expect(existsSync(addedLedgerPath(root))).toBe(false);
    });

    it("失敗時に一時ファイルが残らない（media/ が書けないとき）", async () => {
      rmSync(media, { recursive: true });
      writeFileSync(media, "not a directory"); // media/ の位置にファイルを置いて mkdir/書き込みを失敗させる
      await expect(addMaterial({ bytes_base64: b64(csv), name: "a.csv" }, root)).rejects.toThrow();
      expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toEqual([]);
      expect(existsSync(addedLedgerPath(root))).toBe(false);
      expect(existsSync(join(root, "appdata", "mcp-write-lock.json"))).toBe(false);
    });

    it("別の MCP が書いている間（ロック中）は BUSY で断る", async () => {
      writeFileSync(
        join(root, "appdata", "mcp-write-lock.json"),
        JSON.stringify({ pid: process.pid, token: "other", at: new Date().toISOString() }),
      );
      await expect(addMaterial({ bytes_base64: b64(csv), name: "a.csv" }, root)).rejects.toThrow(/BUSY/);
      expect(readdirSync(media)).toEqual([]);
    });

    it("vault が無ければ失敗する", async () => {
      rmSync(join(root, "notes"), { recursive: true });
      await expect(addMaterial({ bytes_base64: b64(csv), name: "a.csv" }, root)).rejects.toThrow(/vault/);
    });
  });
});
