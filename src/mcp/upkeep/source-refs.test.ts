import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetMediaIndexCache } from "../sources";
import { resolveSourceRefs } from "./source-refs";

let root: string;
beforeEach(() => {
  resetMediaIndexCache();
  root = mkdtempSync(join(tmpdir(), "srcref-"));
  mkdirSync(join(root, "notes"), { recursive: true });
  mkdirSync(join(root, "wiki"), { recursive: true });
  mkdirSync(join(root, "appdata"), { recursive: true });
  writeFileSync(join(root, "notes", "n1.json"), JSON.stringify({ title: "ノート1", pages: [] }));
  writeFileSync(join(root, "wiki", "w1.json"), JSON.stringify({ title: "ウィキ", pages: [] }));
  writeFileSync(
    join(root, "appdata", "media-index.json"),
    JSON.stringify({
      media: [
        { fileId: "f1", name: "論文.pdf", type: "pdf" },
        { fileId: "f2", name: "報告.docx", type: "document" },
        { fileId: "f3", name: "ページ名", type: "url", url: "https://example.com/a" },
      ],
    }),
  );
});
afterEach(() => {
  resetMediaIndexCache();
  rmSync(root, { recursive: true, force: true });
});

describe("resolveSourceRefs", () => {
  it("種類ごとに解決し、見つからないものと wiki ページは missing", () => {
    const { refs, missing } = resolveSourceRefs(
      ["n1", "w1", "pdf:f1", "document:f2", "url:https://example.com/a", "pdf:nope", "url:https://x.example/", "ghost", "chat:abc", "memo:m"],
      root,
    );
    expect(refs.map((r) => r.id)).toEqual(["n1", "pdf:f1", "document:f2", "url:https://example.com/a", "chat:abc", "memo:m"]);
    expect(refs[0].title).toBe("ノート1");
    expect(refs[1].title).toBe("論文.pdf");
    expect(refs[3].title).toBe("ページ名");
    expect(missing).toEqual(["w1", "pdf:nope", "url:https://x.example/", "ghost"]);
  });

  it("重複は除く", () => {
    const { refs } = resolveSourceRefs(["n1", "n1", " n1 "], root);
    expect(refs).toHaveLength(1);
  });
});
