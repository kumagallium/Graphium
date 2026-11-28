// @vitest-environment jsdom
// 戻り先ページ（public/app/auth/onedrive-return.js）のテスト。
// 素の JS なので、ファイルを読んで偽の環境で動かす。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ONEDRIVE_AUTH_CHANNEL } from "./onedrive-auth";

const source = readFileSync(resolve(process.cwd(), "public/app/auth/onedrive-return.js"), "utf8");

function run(hash: string, opts: { opener?: boolean } = {}) {
  const posted: Array<{ name: string; data: Record<string, unknown> }> = [];
  class FakeChannel {
    constructor(public name: string) {}
    postMessage(data: Record<string, unknown>) {
      posted.push({ name: this.name, data });
    }
    close() {}
  }
  const openerPost = vi.fn();
  const replaceState = vi.fn();
  const close = vi.fn();
  const location = { hash, pathname: "/Graphium/app/auth/onedrive.html", origin: "https://app.example" };
  const win = { opener: opts.opener ? { postMessage: openerPost } : null, close };
  const doc = { getElementById: () => ({ textContent: "" }) };
  const fn = new Function(
    "location", "history", "BroadcastChannel", "window", "document", "setTimeout",
    source,
  );
  fn(location, { replaceState }, FakeChannel, win, doc, (cb: () => void) => cb());
  return { posted, openerPost, replaceState, close };
}

describe("onedrive-return.js", () => {
  it("hands code and state to the same-origin channel and removes them from the URL", () => {
    const r = run("#code=abc&state=xyz", { opener: true });
    // チャンネル名は受け取る側と同じでなければ届かない
    expect(r.posted).toEqual([
      {
        name: ONEDRIVE_AUTH_CHANNEL,
        data: { type: ONEDRIVE_AUTH_CHANNEL, code: "abc", state: "xyz", error: undefined, error_description: undefined },
      },
    ]);
    // opener へは同じオリジン宛てに限る
    expect(r.openerPost).toHaveBeenCalledWith(expect.objectContaining({ code: "abc" }), "https://app.example");
    expect(r.replaceState).toHaveBeenCalledWith(null, "", "/Graphium/app/auth/onedrive.html");
    expect(r.close).toHaveBeenCalled();
  });

  it("passes an error return through", () => {
    const r = run("#error=access_denied&state=xyz");
    expect(r.posted[0].data).toMatchObject({ error: "access_denied", state: "xyz" });
  });

  it("sends nothing when opened directly", () => {
    const r = run("", { opener: true });
    expect(r.posted).toEqual([]);
    expect(r.openerPost).not.toHaveBeenCalled();
    expect(r.close).not.toHaveBeenCalled();
  });
});
