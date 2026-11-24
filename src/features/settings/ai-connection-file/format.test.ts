import { describe, it, expect } from "vitest";
import {
  buildConnectionFile,
  ConnectionFileError,
  destinationOf,
  keyKind,
  parseConnectionFile,
  parseConnectionFileText,
  planImport,
  suggestedFileName,
} from "./format";
import { decryptKey, encryptKey, keyBinding } from "./crypto";

const LAB = {
  provider: "openai-compatible" as const,
  apiBase: "http://lab-ws.example.test:8000/v1",
  models: [{ name: "研究室のサーバー", modelId: "local-model-a" }],
};

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ConnectionFileError ? e.code : "other";
  }
  return "none";
};

describe("buildConnectionFile / parseConnectionFile", () => {
  it("書き出したものを読み込める（キーなし）", () => {
    const f = buildConnectionFile({ ...LAB, from: " 熊谷 ", now: new Date("2026-11-24T00:00:00Z") });
    expect(f.from).toBe("熊谷");
    expect(f.createdAt).toBe("2026-11-24T00:00:00.000Z");
    expect(keyKind(f)).toBe("none");
    expect(parseConnectionFileText(JSON.stringify(f))).toEqual(f);
  });

  it("平文のキーを入れられる", () => {
    const f = buildConnectionFile({ ...LAB, key: { plain: "dummy-key-123" } });
    expect(keyKind(f)).toBe("plain");
  });

  it("JSON でないもの・別の形は断る", () => {
    expect(codeOf(() => parseConnectionFileText("not json"))).toBe("notJson");
    expect(codeOf(() => parseConnectionFile({ format: "graphium-demo-bundle" }))).toBe("notConnectionFile");
    expect(codeOf(() => parseConnectionFile({ format: "graphium-ai-connection", version: 2, connection: {} }))).toBe("unsupportedVersion");
  });

  it("配れない種類（本人のサインインで使うもの）は断る", () => {
    const f = { ...buildConnectionFile(LAB) } as unknown as Record<string, unknown>;
    (f.connection as Record<string, unknown>).provider = "copilot-subscription";
    expect(codeOf(() => parseConnectionFile(f))).toBe("badProvider");
  });

  it("送り先は http / https だけ。ユーザー名入りの URL も断る", () => {
    for (const apiBase of ["file:///etc/passwd", "javascript:alert(1)", "http://user:pw@host/v1", "not a url"]) {
      expect(codeOf(() => buildConnectionFile({ ...LAB, apiBase }))).toBe("badApiBase");
    }
  });

  it("OpenAI 互換は送り先が要る。各社の既定は送り先が空でよい", () => {
    expect(codeOf(() => buildConnectionFile({ ...LAB, apiBase: null }))).toBe("badApiBase");
    const f = buildConnectionFile({ provider: "openai", apiBase: null, models: [{ name: "o", modelId: "m" }], key: { plain: "dummy" } });
    expect(destinationOf(f)).toEqual({ host: "api.openai.com", url: null, secure: true });
  });

  it("モデルが無い・名前が空は断る", () => {
    expect(codeOf(() => buildConnectionFile({ ...LAB, models: [] }))).toBe("noModels");
    expect(codeOf(() => buildConnectionFile({ ...LAB, models: [{ name: " ", modelId: "x" }] }))).toBe("badModel");
  });

  it("各社の公式の API はキーが要る（キーなしで読み込むと使うまで失敗に気づけない）", () => {
    expect(codeOf(() => buildConnectionFile({ provider: "openai", apiBase: null, models: [{ name: "o", modelId: "m" }] }))).toBe("keyRequired");
  });

  it("同じモデルが 2 度書かれたファイルは断る", () => {
    expect(codeOf(() => buildConnectionFile({ ...LAB, models: [{ name: "a", modelId: "x" }, { name: "b", modelId: "x" }] }))).toBe("badModel");
  });

  it("壊れたキーの欄は断る", () => {
    const f = buildConnectionFile(LAB) as unknown as Record<string, unknown>;
    expect(codeOf(() => parseConnectionFile({ ...f, key: { encrypted: { alg: "AES-CBC" } } }))).toBe("badKey");
    expect(codeOf(() => parseConnectionFile({ ...f, key: { plain: "" } }))).toBe("badKey");
  });
});

describe("destinationOf", () => {
  it("ホスト名と、暗号化されない http かどうかを返す", () => {
    expect(destinationOf(buildConnectionFile(LAB))).toEqual({ host: "lab-ws.example.test:8000", url: LAB.apiBase, secure: false });
  });
});

describe("planImport", () => {
  const file = buildConnectionFile({
    ...LAB,
    models: [
      { name: "研究室のサーバー", modelId: "local-model-a" },
      { name: "研究室のサーバー（大）", modelId: "local-model-b" },
    ],
  });

  it("何も無ければ全部足す", () => {
    expect(planImport(file, []).map((s) => s.action)).toEqual(["add", "add"]);
  });

  it("同じ送り先・同じモデルがあればとばす（末尾の / と大文字小文字は同じとみなす）", () => {
    const steps = planImport(file, [
      { name: "前に読み込んだもの", provider: "openai-compatible", apiBase: "HTTP://lab-ws.example.test:8000/v1/", modelId: "local-model-a" },
    ]);
    expect(steps[0]).toEqual({ action: "skip", name: "研究室のサーバー", modelId: "local-model-a", existingName: "前に読み込んだもの" });
    expect(steps[1].action).toBe("add");
  });

  it("名前だけがぶつかるときは置き換えず、別の名前で足す（送り先の差し替えを防ぐ）", () => {
    const steps = planImport(file, [
      { name: "研究室のサーバー", provider: "openai-compatible", apiBase: "http://other.example.test/v1", modelId: "local-model-a" },
      { name: "研究室のサーバー (2)", provider: "openai", apiBase: null, modelId: "x" },
    ]);
    expect(steps[0]).toEqual({ action: "add", name: "研究室のサーバー (3)", modelId: "local-model-a" });
  });
});

describe("suggestedFileName", () => {
  it("ファイル名に使えない文字を除いて拡張子を付ける", () => {
    expect(suggestedFileName('研究室/LLM:"A"')).toBe("研究室LLMA.graphium-ai.json");
    expect(suggestedFileName("")).toBe("ai-connection.graphium-ai.json");
  });
});

describe("encryptKey / decryptKey", () => {
  // テストは反復回数を下げて速くする（形の下限 100,000 は満たす）
  const ITER = 100_000;
  const BIND = keyBinding(LAB.provider, LAB.apiBase);

  it("同じパスフレーズで戻せる。ファイルに書いて読み戻しても戻せる", async () => {
    const enc = await encryptKey("dummy-key-123", "correct horse", BIND, ITER);
    expect(enc.data).not.toContain("dummy");
    const f = buildConnectionFile({ ...LAB, key: { encrypted: enc } });
    const back = parseConnectionFileText(JSON.stringify(f));
    expect(keyKind(back)).toBe("encrypted");
    if (back.key && "encrypted" in back.key) {
      expect(await decryptKey(back.key.encrypted, "correct horse", BIND)).toBe("dummy-key-123");
    }
  });

  it("違うパスフレーズでは戻せない", async () => {
    const enc = await encryptKey("dummy-key-123", "correct horse", BIND, ITER);
    await expect(decryptKey(enc, "wrong horse!", BIND)).rejects.toThrow("wrongPassphrase");
  });

  it("送り先を書き換えたファイルでは、正しいパスフレーズでも戻せない", async () => {
    const enc = await encryptKey("dummy-key-123", "correct horse", BIND, ITER);
    await expect(decryptKey(enc, "correct horse", keyBinding(LAB.provider, "http://attacker.example.test/v1"))).rejects.toThrow("wrongPassphrase");
  });

  it("合成の形が違う日本語のパスフレーズ（NFC と NFD）でも戻せる", async () => {
    const nfc = "がくせいのパスワード".normalize("NFC");
    const nfd = nfc.normalize("NFD");
    expect(nfd).not.toBe(nfc);
    const enc = await encryptKey("dummy-key-123", nfc, BIND, ITER);
    expect(await decryptKey(enc, nfd, BIND)).toBe("dummy-key-123");
  });

  it("短いパスフレーズでは暗号化しない", async () => {
    await expect(encryptKey("k", "short", BIND, ITER)).rejects.toThrow("passphraseTooShort");
  });
});
