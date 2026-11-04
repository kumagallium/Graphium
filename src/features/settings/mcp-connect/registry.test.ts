// 公式 MCP Registry の 1 件を「キーを入れれば繋がる形」に読み替えるところのテスト。
// 例の形は 2026-11-04 に registry.modelcontextprotocol.io/v0/servers が返したものに合わせている。

import { describe, expect, it, vi } from "vitest";
import {
  buildRemoteEntry,
  hasRequiredValues,
  publisherOf,
  toRegistryResult,
  toRegistryResults,
  toServerName,
  type ConnectOption,
} from "./registry";
import { CURATED_SERVERS, checkCuratedKey, curatedToOption } from "./catalog";

const exa = {
  server: {
    name: "ai.exa/exa",
    title: "Exa",
    description: "Web search",
    remotes: [{ type: "streamable-http", url: "https://mcp.exa.ai/mcp" }],
  },
  _meta: {},
};

const withBearer = {
  server: {
    name: "ae.waggle/vera",
    remotes: [
      {
        type: "streamable-http",
        url: "https://vera.waggle.ae/v1/mcp",
        headers: [{ name: "Authorization", description: "Bearer token", isRequired: true, isSecret: true, placeholder: "Bearer vera_live_..." }],
      },
    ],
  },
};

const withXApiKey = {
  server: {
    name: "agency.thirdhemisphere/ai-authority-index",
    remotes: [
      {
        type: "streamable-http",
        url: "https://thirdhemisphere.agency/mcp",
        headers: [{ name: "x-api-key", description: "Optional free API key", isSecret: true }],
      },
    ],
  },
};

const npmOnly = {
  server: {
    name: "io.github.tavily-ai/tavily-mcp",
    packages: [{ registryType: "npm", identifier: "tavily-mcp" }],
  },
};

const urlVariables = {
  server: {
    name: "com.example/tenant",
    remotes: [{ type: "streamable-http", url: "https://{tenant}.example.com/mcp" }],
  },
};

describe("publisherOf", () => {
  it("GitHub で確かめた名前は github.com/持ち主 にする", () => {
    expect(publisherOf("io.github.tavily-ai/tavily-mcp")).toBe("github.com/tavily-ai");
  });
  it("ドメインの名前は逆ドメインを戻す", () => {
    expect(publisherOf("ai.exa/exa")).toBe("exa.ai");
    expect(publisherOf("ai.smithery/exa-labs-exa-code-mcp")).toBe("smithery.ai");
  });
});

describe("toServerName", () => {
  it("/ の後ろを英数字と - だけにする", () => {
    expect(toServerName("ai.exa/exa")).toBe("exa");
    expect(toServerName("com.example/My Server!")).toBe("my-server");
  });
});

describe("toRegistryResult", () => {
  it("キーの要らないリモートは欄なしで繋げる", () => {
    const r = toRegistryResult(exa);
    expect(r?.kind).toBe("remote");
    if (r?.kind !== "remote") return;
    expect(r.option).toMatchObject({ url: "https://mcp.exa.ai/mcp", transport: "streamable-http", fields: [], publisher: "exa.ai" });
  });

  it("headers から欄を作る（Authorization は Bearer 扱い）", () => {
    const r = toRegistryResult(withBearer);
    if (r?.kind !== "remote") throw new Error("remote のはず");
    expect(r.option.fields).toEqual([
      expect.objectContaining({ header: "Authorization", required: true, secret: true, bearer: true }),
    ]);
  });

  it("パッケージだけのものはこのパソコンでは動かせない扱い", () => {
    expect(toRegistryResult(npmOnly)?.kind).toBe("needs-local");
  });

  it("URL に変数を含むものはまだ扱わない", () => {
    expect(toRegistryResult(urlVariables)?.kind).toBe("unsupported");
  });

  it("SSE と Streamable HTTP があれば Streamable HTTP を選ぶ", () => {
    const r = toRegistryResult({
      server: {
        name: "com.example/both",
        remotes: [
          { type: "sse", url: "https://example.com/sse" },
          { type: "streamable-http", url: "https://example.com/mcp" },
        ],
      },
    });
    if (r?.kind !== "remote") throw new Error("remote のはず");
    expect(r.option.url).toBe("https://example.com/mcp");
  });

  it("名前の無いものは捨てる", () => {
    expect(toRegistryResult({ server: { title: "x" } })).toBeNull();
    expect(toRegistryResult(null)).toBeNull();
  });
});

describe("toRegistryResults", () => {
  it("繋げるものを先に並べ、同じ名前は 1 件にする", () => {
    const rs = toRegistryResults([npmOnly, exa, urlVariables, withBearer, exa]);
    expect(rs.map((r) => r.kind)).toEqual(["remote", "remote", "needs-local", "unsupported"]);
  });

  it("語に名前が合うものを先にする（部分一致で混ざったものは後ろ）", () => {
    const apex = { server: { name: "academy.apexai/apex-ai-academy", title: "Apex AI Academy", remotes: [{ type: "streamable-http", url: "https://apexai.academy/mcp" }] } };
    const rs = toRegistryResults([apex, exa], "exa");
    expect(rs.map((r) => (r.kind === "remote" ? r.option.id : r.id))).toEqual(["ai.exa/exa", "academy.apexai/apex-ai-academy"]);
  });
});

describe("buildRemoteEntry", () => {
  const option = (toRegistryResult(withBearer) as { option: ConnectOption }).option;

  it("Authorization の値は apiKey にし、貼られた Bearer は外す", () => {
    const e = buildRemoteEntry(option, { Authorization: "Bearer vera_live_abc " }, "id1");
    expect(e).toMatchObject({ type: "remote", id: "id1", name: "vera", apiKey: "vera_live_abc" });
    expect(e.headers).toBeUndefined();
  });

  it("Bearer 以外の方式ならそのまま Authorization に入れる", () => {
    const e = buildRemoteEntry(option, { Authorization: "Basic dXNlcjpwYXNz" }, "id1");
    expect(e.apiKey).toBeUndefined();
    expect(e.headers).toEqual({ Authorization: "Basic dXNlcjpwYXNz" });
  });

  it("ほかの名前のヘッダーは headers に入れ、空の欄は送らない", () => {
    const opt = (toRegistryResult(withXApiKey) as { option: ConnectOption }).option;
    expect(buildRemoteEntry(opt, { "x-api-key": "k1" }, "id").headers).toEqual({ "x-api-key": "k1" });
    expect(buildRemoteEntry(opt, {}, "id").headers).toBeUndefined();
  });

  it("登録名を差し替えられる", () => {
    expect(buildRemoteEntry(option, {}, "id", "vera-2").name).toBe("vera-2");
  });
});

describe("hasRequiredValues", () => {
  const option = (toRegistryResult(withBearer) as { option: ConnectOption }).option;
  it("必須の欄が空なら false", () => {
    expect(hasRequiredValues(option, {})).toBe(false);
    expect(hasRequiredValues(option, { Authorization: "  " })).toBe(false);
    expect(hasRequiredValues(option, { Authorization: "k" })).toBe(true);
  });
});

describe("厳選の接続先（catalog.json）", () => {
  it("どれも https のリモートで、キーの欄が 1 つある", () => {
    expect(CURATED_SERVERS.length).toBeGreaterThan(0);
    for (const s of CURATED_SERVERS) {
      expect(s.url.startsWith("https://")).toBe(true);
      expect(/^\d{4}-\d{2}-\d{2}$/.test(s.checkedAt)).toBe(true);
      if (s.keyCheckUrl) expect(s.keyCheckUrl.startsWith("https://")).toBe(true);
      expect(s.text.ja.what && s.text.en.what).toBeTruthy();
      const opt = curatedToOption(s, "ja");
      expect(opt.fields).toHaveLength(1);
      expect(opt.fields[0].required).toBe(true);
    }
  });

  it("Tavily はキーを Bearer で送る", () => {
    const tavily = CURATED_SERVERS.find((s) => s.id === "tavily")!;
    const e = buildRemoteEntry(curatedToOption(tavily, "en"), { Authorization: "tvly-abc" }, "id");
    expect(e).toMatchObject({ url: "https://mcp.tavily.com/mcp/", transport: "streamable-http", apiKey: "tvly-abc", name: "tavily" });
  });
});

describe("checkCuratedKey", () => {
  const url = "https://api.tavily.com/usage";
  it("401 ならキーが違う", async () => {
    expect(await checkCuratedKey(url, "bad", vi.fn(async () => new Response("", { status: 401 })))).toBe("invalid");
  });
  it("200 なら通す。貼られた Bearer は外して送る", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await checkCuratedKey(url, "Bearer tvly-1 ", f)).toBe("ok");
    const init = (f.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tvly-1");
  });
  it("つながらない・500 は確かめられなかった扱い（握手に進む）", async () => {
    expect(await checkCuratedKey(url, "k", vi.fn(async () => { throw new Error("offline"); }))).toBe("unknown");
    expect(await checkCuratedKey(url, "k", vi.fn(async () => new Response("", { status: 500 })))).toBe("unknown");
  });
});
