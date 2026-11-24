// offer_material（material-offer.ts）の回帰テスト。一時 vault と一時の「手元のファイル」で回す。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetMediaIndexCache } from "./sources";
import { allowedRoots, cleanOfferName, deniedLocationReason, offerMaterial } from "./material-offer";
import { offerBytesKey, offerMetaKey, parseOfferMeta, OFFER_MAX_PENDING } from "../features/material-offer/offer-file";

describe("offer_material", () => {
  let root: string;
  let outside: string;
  let home: string;

  const appdata = () => join(root, "appdata");
  const offerFiles = () => readdirSync(appdata()).filter((f) => f.startsWith("material-offer-"));
  function put(name: string, content: string | Buffer, dir = outside) {
    const p = join(dir, name);
    writeFileSync(p, content);
    return p;
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "graphium-offer-vault-")));
    outside = realpathSync(mkdtempSync(join(tmpdir(), "graphium-offer-src-")));
    home = realpathSync(mkdtempSync(join(tmpdir(), "graphium-offer-home-")));
    mkdirSync(join(root, "notes"), { recursive: true });
    mkdirSync(join(root, "appdata"), { recursive: true });
    mkdirSync(join(root, "media"), { recursive: true });
    resetMediaIndexCache();
  });

  afterEach(() => {
    for (const d of [root, outside, home]) rmSync(d, { recursive: true, force: true });
    resetMediaIndexCache();
  });

  it("写しと元の場所を受け取り待ちに置き、素材にはしない", async () => {
    const p = put("1-crumb.jpg", Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]));
    const r = await offerMaterial({ path: p, name: "crumb.jpg" }, { root, clientName: "codex-mcp-client", home, tmpRoots: [outside] });
    expect(r.status).toBe("offered");
    if (r.status !== "offered") return;
    const meta = parseOfferMeta(JSON.parse(readFileSync(join(appdata(), `${offerMetaKey(r.id)}.json`), "utf8")));
    expect(meta).toMatchObject({ name: "crumb.jpg", mimeType: "image/jpeg", size: 5, sourcePath: p, client: "ChatGPT / Codex" });
    const bytes = JSON.parse(readFileSync(join(appdata(), `${offerBytesKey(r.id)}.json`), "utf8")) as { base64: string };
    expect(Buffer.from(bytes.base64, "base64")).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]));
    // 素材（media/）には何も足さない
    expect(readdirSync(join(root, "media"))).toEqual([]);
  });

  it("同じ中身の申し出が待っていれば、新しく作らずその id を返す", async () => {
    const a = put("a.csv", "x,y\n1,2\n");
    const b = put("b.csv", "x,y\n1,2\n");
    const r1 = await offerMaterial({ path: a }, { root, home, tmpRoots: [outside] });
    const r2 = await offerMaterial({ path: b }, { root, home, tmpRoots: [outside] });
    expect(r2.status).toBe("already_offered");
    if (r1.status === "offered" && r2.status === "already_offered") expect(r2.id).toBe(r1.id);
    expect(offerFiles()).toHaveLength(2);
  });

  it("同じ中身の素材が既にあれば、写しを置かずに素材の id を返す", async () => {
    const content = "already here";
    const hash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    writeFileSync(join(root, "media", "m1.txt.dat"), content);
    writeFileSync(join(root, "media", "m1"), content);
    writeFileSync(
      join(root, "appdata", "media-index.json"),
      JSON.stringify({
        version: 1,
        media: [{ fileId: "m1", name: "x.md", type: "document", mimeType: "text/markdown", url: "", thumbnailUrl: "", uploadedAt: "2026-10-01T00:00:00Z", usedIn: [], contentHash: hash }],
      }),
    );
    resetMediaIndexCache();
    const r = await offerMaterial({ path: put("x.md", content) }, { root, home, tmpRoots: [outside] });
    expect(r).toEqual({ status: "already_material", materialId: "m1" });
    expect(offerFiles()).toEqual([]);
  });

  it("実在するノートだけ結び付ける", async () => {
    writeFileSync(join(root, "notes", "n1.json"), JSON.stringify({ title: "Rye", pages: [] }));
    const r1 = await offerMaterial({ path: put("a.png", "a"), note_id: "n1" }, { root, home, tmpRoots: [outside] });
    const r2 = await offerMaterial({ path: put("b.png", "b"), note_id: "missing" }, { root, home, tmpRoots: [outside] });
    expect(r1).toMatchObject({ status: "offered", noteLinked: true });
    expect(r2).toMatchObject({ status: "offered", noteLinked: false });
  });

  it("相対パス・フォルダ・シンボリックリンク・空・実行ファイルは断る", async () => {
    await expect(offerMaterial({ path: "a.png" }, { root, home, tmpRoots: [outside] })).rejects.toThrow(/絶対パス/);
    await expect(offerMaterial({ path: outside }, { root, home, tmpRoots: [outside] })).rejects.toThrow(/ふつうのファイル/);
    const target = put("t.png", "t");
    const link = join(outside, "link.png");
    symlinkSync(target, link);
    await expect(offerMaterial({ path: link }, { root, home, tmpRoots: [outside] })).rejects.toThrow(/シンボリックリンク/);
    await expect(offerMaterial({ path: put("e.png", "") }, { root, home, tmpRoots: [outside] })).rejects.toThrow(/空/);
    await expect(offerMaterial({ path: put("run.sh", "echo") }, { root, home, tmpRoots: [outside] })).rejects.toThrow(/\.sh/);
    // 名前だけ無害にしても、元のファイルの拡張子で断る
    await expect(offerMaterial({ path: put("x.command", "echo"), name: "x.txt" }, { root, home, tmpRoots: [outside] })).rejects.toThrow(/\.command/);
    await expect(offerMaterial({ path: join(outside, "nope.png") }, { root, home, tmpRoots: [outside] })).rejects.toThrow(/見つかりません/);
    expect(offerFiles()).toEqual([]);
  });

  it("隠しフォルダ・許す場所の外・vault の中は断り、ホームのダウンロードは通す", async () => {
    mkdirSync(join(outside, ".ssh"));
    await expect(offerMaterial({ path: put("id_ed25519.txt", "k", join(outside, ".ssh")) }, { root, home, tmpRoots: [outside] })).rejects.toThrow(/この場所/);
    for (const d of [join(home, "Library", "Application Support", "Firefox"), join(home, "Library", "Keychains")]) {
      mkdirSync(d, { recursive: true });
      await expect(offerMaterial({ path: put("key4.db", "k", d) }, { root, home, tmpRoots: [outside] })).rejects.toThrow(/この場所/);
    }
    await expect(offerMaterial({ path: put("n.txt", "n", join(root, "notes")) }, { root, home, tmpRoots: [outside] })).rejects.toThrow(/この場所/);
    mkdirSync(join(home, "Downloads"));
    const ok = await offerMaterial({ path: put("plan.pdf", "%PDF-1", join(home, "Downloads")) }, { root, home, tmpRoots: [outside] });
    expect(ok.status).toBe("offered");
    expect(offerFiles()).toHaveLength(2);
  });

  it("ハードリンクは断る（許す場所に、別の場所の中身を見せかけさせない）", async () => {
    mkdirSync(join(home, "Library"), { recursive: true });
    const secret = put("id_rsa", "PRIVATE KEY", join(home, "Library"));
    const link = join(outside, "photo.png");
    linkSync(secret, link);
    expect(statSync(link).nlink).toBe(2);
    await expect(offerMaterial({ path: link }, { root, home, tmpRoots: [outside] })).rejects.toThrow(/ハードリンク/);
    expect(offerFiles()).toEqual([]);
  });

  it("deniedLocationReason は UNC・OS の場所を断り、一時フォルダは通す", () => {
    const roots = ["/private/tmp", "/private/var/folders/84/abc/T", "/Users/u/Downloads"];
    expect(deniedLocationReason("\\\\attacker.example\\share\\a.png", "/v", roots)).not.toBeNull();
    expect(deniedLocationReason("//attacker.example/share/a.png", "/v", roots)).not.toBeNull();
    expect(deniedLocationReason("/private/etc/passwd", "/v", roots)).not.toBeNull();
    expect(deniedLocationReason("/private/tmp/codex-remote-attachments/x/1-a.jpg", "/v", roots)).toBeNull();
    expect(deniedLocationReason("/private/var/folders/84/abc/T/TemporaryItems/NSIRD_x/a.png", "/v", roots)).toBeNull();
    expect(deniedLocationReason("/Users/u/Library/Cookies/c.binarycookies", "/v", roots)).not.toBeNull();
    expect(deniedLocationReason("/Users/u/Downloads/.hidden/a.png", "/v", roots)).not.toBeNull();
    expect(allowedRoots("/Users/u", ["/private/tmp"])).toContain("/Users/u/Downloads");
  });

  it("名前の書式文字・区切り・末尾のドットを落とし、ドットで始まる名前は断る", async () => {
    expect(cleanOfferName("a\u202Egpj.exe")).toBe("agpj.exe");
    expect(cleanOfferName("../x/y.png")).toBe("y.png");
    expect(cleanOfferName("evil.cmd. ")).toBe("evil.cmd");
    await expect(offerMaterial({ path: put("z.txt", "z"), name: ".bat" }, { root, home, tmpRoots: [outside] })).rejects.toThrow(/ドット/);
  });

  it("待っている数が上限なら断り、期限切れは片付けてから数える", async () => {
    const now = Date.parse("2026-11-24T00:00:00Z");
    for (let i = 0; i < OFFER_MAX_PENDING; i++) {
      await offerMaterial({ path: put(`f${i}.txt`, `c${i}`) }, { root, home, tmpRoots: [outside], now });
    }
    await expect(offerMaterial({ path: put("over.txt", "over") }, { root, home, tmpRoots: [outside], now })).rejects.toThrow(/承認を待っている/);
    // 15 日後には全部期限切れなので、片付けて受け付ける
    const later = now + 15 * 24 * 60 * 60 * 1000;
    const r = await offerMaterial({ path: put("over2.txt", "over2") }, { root, home, tmpRoots: [outside], now: later });
    expect(r.status).toBe("offered");
    expect(offerFiles()).toHaveLength(2);
  });
});
