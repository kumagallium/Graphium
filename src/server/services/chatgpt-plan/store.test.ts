import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDataDir, setDataDir } from "../../config/models.js";
import { loadAuth, persistAuth, updateAuth, withoutTokens, type ChatGptAccount } from "./store.js";

describe("chatgpt-plan store", () => {
  let dir: string;
  let prev: string;
  beforeEach(() => {
    prev = getDataDir();
    dir = mkdtempSync(join(tmpdir(), "chatgpt-store-"));
    setDataDir(dir);
  });
  afterEach(() => {
    setDataDir(prev);
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const account: ChatGptAccount = {
    email: "a@example.com",
    subject: "sub-1",
    clientId: "oaiapp_1",
    idToken: "id",
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: 1,
    savedAt: 1,
  };

  it("loadAuth は読むだけで書かない。hostId は persistAuth のとき保存され、以後同じ値", () => {
    const a = loadAuth();
    expect(a.hostId).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(a.account).toBeNull();
    expect(existsSync(join(dir, "chatgpt-plan"))).toBe(false);
    persistAuth(a);
    expect(loadAuth().hostId).toBe(a.hostId);
  });

  it("updateAuth で保存でき、一時ファイルは残らない", () => {
    updateAuth((c) => ({ ...c, account }));
    expect(loadAuth().account?.subject).toBe("sub-1");
    expect(readdirSync(join(dir, "chatgpt-plan"))).toEqual(["auth.json"]);
  });

  it.skipIf(process.platform === "win32")("ファイルは 0600・ディレクトリは 0700", () => {
    updateAuth((c) => ({ ...c, account }));
    expect(statSync(join(dir, "chatgpt-plan", "auth.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "chatgpt-plan")).mode & 0o777).toBe(0o700);
  });

  it("壊れた JSON は broken-<時刻> に退避して空として始める", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mkdirSync(join(dir, "chatgpt-plan"), { recursive: true });
    writeFileSync(join(dir, "chatgpt-plan", "auth.json"), "{not json");
    const a = loadAuth();
    expect(a.account).toBeNull();
    expect(warn).toHaveBeenCalled();
    const files = readdirSync(join(dir, "chatgpt-plan"));
    expect(files.some((f) => f.startsWith("auth.json.broken-"))).toBe(true);
    expect(files).not.toContain("auth.json");
  });

  it.skipIf(process.platform === "win32")("読み取りエラー（EACCES 等）は投げ、上書きしない", () => {
    mkdirSync(join(dir, "chatgpt-plan"), { recursive: true });
    const f = join(dir, "chatgpt-plan", "auth.json");
    writeFileSync(f, JSON.stringify({ hostId: "urn:uuid:x", account: null }));
    chmodSync(f, 0o000);
    try {
      if (process.getuid?.() === 0) return; // root は読めてしまう
      expect(() => loadAuth()).toThrow();
      expect(() => updateAuth((c) => c)).toThrow();
    } finally {
      chmodSync(f, 0o600);
    }
    expect(JSON.parse(readFileSync(f, "utf-8")).hostId).toBe("urn:uuid:x");
  });

  it("pendingClientId は保存・読み込みで保たれ、account があっても壊さない", () => {
    updateAuth((c) => ({ ...c, pendingClientId: "oaiapp_pending" }));
    expect(loadAuth().pendingClientId).toBe("oaiapp_pending");
    expect(loadAuth().account).toBeNull();
    updateAuth((c) => ({ ...c, account }));
    const a = loadAuth();
    expect(a.pendingClientId).toBe("oaiapp_pending");
    expect(a.account).toMatchObject({ subject: "sub-1", clientId: "oaiapp_1" });
    updateAuth(({ pendingClientId: _p, ...rest }) => rest);
    expect(loadAuth().pendingClientId).toBeUndefined();
    expect(loadAuth().account?.subject).toBe("sub-1");
  });

  it("pendingClientId が文字列でなければ無視する", () => {
    mkdirSync(join(dir, "chatgpt-plan"), { recursive: true });
    writeFileSync(join(dir, "chatgpt-plan", "auth.json"), JSON.stringify({ hostId: "urn:uuid:x", account: null, pendingClientId: 5 }));
    expect(loadAuth().pendingClientId).toBeUndefined();
  });

  it("withoutTokens は識別子だけを残す", () => {
    const w = withoutTokens(account);
    expect(w).toMatchObject({ email: "a@example.com", subject: "sub-1", clientId: "oaiapp_1" });
    expect(w.accessToken).toBeUndefined();
    expect(w.refreshToken).toBeUndefined();
    expect(w.idToken).toBeUndefined();
    expect(withoutTokens(account, { keepIdToken: true }).idToken).toBe("id");
  });
});
