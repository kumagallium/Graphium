// source-check-list.ts（list_source_check の本体）の回帰テスト。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listSourceCheck } from "./source-check-list";

function wiki(title: string, kind: string, sourceCheck?: object) {
  return {
    version: 2,
    title,
    source: "ai",
    wikiMeta: { kind, derivedFromNotes: [], ...(sourceCheck ? { sourceCheck } : {}) },
    pages: [{ id: "p", blocks: [] }],
  };
}

const sc = (verdict: string, extra: object = {}) => ({
  verdict,
  checkedAt: "2026-10-01T00:00:00Z",
  checkedBy: "local",
  claimHash: "h",
  entries: [
    {
      sourceId: "pdf:x",
      sourceKind: "pdf",
      verdict,
      rationale: "原文は 300 K と述べている",
      quote: "at 300 K the value is 1.2",
      quoteLocation: { page: 3 },
      statement: "400 K で 1.2 になる",
    },
  ],
  ...extra,
});

describe("listSourceCheck", () => {
  let root: string;
  const write = (id: string, doc: object) => writeFileSync(join(root, "wiki", `${id}.json`), JSON.stringify(doc));

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "graphium-mcp-source-check-"));
    mkdirSync(join(root, "notes"), { recursive: true });
    mkdirSync(join(root, "wiki"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("contradicted → not-in-source の順で、文と出典の抜粋を返す", () => {
    write("a", wiki("あとの判定", "topic", sc("not-in-source")));
    write("b", wiki("先の判定", "answer", sc("contradicted")));
    const out = listSourceCheck(root);
    expect(out).toContain("要確認のページ（2 件）");
    expect(out.indexOf("先の判定")).toBeLessThan(out.indexOf("あとの判定"));
    expect(out).toContain("出典と異なる");
    expect(out).toContain("文: 400 K で 1.2 になる");
    expect(out).toContain("出典の抜粋（p.3）: at 300 K the value is 1.2");
    expect(out).toContain("Graphium の手入れ → 出典照合で確かめられます");
  });

  it("supported・確認済み・照合なし・対象外の種別は出ない", () => {
    write("a", wiki("支持", "topic", sc("supported")));
    write("b", wiki("確認済み", "topic", sc("contradicted", { dismissed: true })));
    write("c", wiki("未照合", "topic"));
    write("d", wiki("洞察", "atom", sc("contradicted")));
    expect(listSourceCheck(root)).toContain("「要確認」になっているページはありません");
  });

  it("entries は最大 3 件までで、残りは件数だけ示す", () => {
    const many = sc("contradicted");
    many.entries = Array.from({ length: 5 }, (_, i) => ({ ...many.entries[0], statement: `文${i}` }));
    write("a", wiki("たくさん", "topic", many));
    const out = listSourceCheck(root);
    expect(out).toContain("文2");
    expect(out).not.toContain("文3");
    expect(out).toContain("…ほか 2 件");
  });
});
