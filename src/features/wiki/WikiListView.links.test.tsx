// @vitest-environment jsdom
// WikiListView の「リンク」列のテスト。生成元（出典の引用）へのリンクは数えず、
// それ以外へ張ったリンクだけを数える — 数えると「生成元」列と同じ数字が並ぶだけになるため。
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WikiListView } from "./WikiListView";
import { LocaleProvider } from "../../i18n";
import type { GraphiumFile, WikiMetaSummary } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

function file(id: string, name: string): GraphiumFile {
  return { id, name, modifiedTime: "2026-01-01T00:00:00Z", createdTime: "2026-01-01T00:00:00Z" };
}

function entry(noteId: string, derivedFromNotes: string[], targets: string[]) {
  return {
    noteId,
    title: noteId,
    derivedFromNotes,
    outgoingLinks: targets.map((targetNoteId) => ({ targetNoteId, layer: "knowledge" as const })),
  };
}

/** 見出し「Links」と同じ列の、指定タイトルの行のセルの文字 */
function linksCell(title: string): string {
  const headers = [...document.querySelectorAll("thead th")];
  const col = headers.findIndex((th) => th.textContent?.startsWith("Links"));
  expect(col).toBeGreaterThan(-1);
  const row = screen.getByText(title).closest("tr")!;
  return row.querySelectorAll("td")[col].textContent ?? "";
}

describe("WikiListView リンク列", () => {
  it("生成元へのリンクは数えず、それ以外へのリンクだけを数える", () => {
    const files = [file("t1", "トピック1"), file("t2", "トピック2")];
    const metas = new Map<string, WikiMetaSummary>([
      ["t1", { title: "トピック1", kind: "topic" }],
      ["t2", { title: "トピック2", kind: "topic" }],
    ]);
    const noteIndex = {
      notes: [
        // 出典の引用（pdf:a）だけ → 0
        entry("t1", ["pdf:a"], ["pdf:a", "pdf:a"]),
        // 出典の引用に加えて別のトピックと別ノートへのリンク → 2
        entry("t2", ["pdf:b"], ["pdf:b", "t1", "note-x", "t1"]),
      ],
    } as unknown as GraphiumIndex;
    render(
      <LocaleProvider>
        <WikiListView
          noteIndex={noteIndex}
          wikiKind="topic"
          wikiFiles={files}
          wikiMetas={metas}
          onOpenWiki={() => {}}
          onBack={() => {}}
          onDeleteWiki={async () => {}}
        />
      </LocaleProvider>,
    );
    expect(linksCell("トピック1")).toBe("—");
    expect(linksCell("トピック2")).toBe("2");
  });

  it("値のある行が 1 件でもあれば列を出し、絞り込んでも列は出たままにする", () => {
    const files = [file("t1", "トピック1"), file("t2", "トピック2")];
    const metas = new Map<string, WikiMetaSummary>([
      ["t1", { title: "トピック1", kind: "topic" }],
      ["t2", { title: "トピック2", kind: "topic" }],
    ]);
    const noteIndex = {
      notes: [entry("t1", ["pdf:a"], ["pdf:a"]), entry("t2", ["pdf:b"], ["pdf:b", "t1"])],
    } as unknown as GraphiumIndex;
    render(
      <LocaleProvider>
        <WikiListView
          noteIndex={noteIndex}
          wikiKind="topic"
          wikiFiles={files}
          wikiMetas={metas}
          onOpenWiki={() => {}}
          onBack={() => {}}
          onDeleteWiki={async () => {}}
        />
      </LocaleProvider>,
    );
    // リンクは t2 だけ、被参照は t1 だけに値がある。どちらの列も出て、値の無い行は「—」
    expect(linksCell("トピック1")).toBe("—");
    expect(cellUnder("Refs in", "トピック1")).toBe("1");
    expect(cellUnder("Refs in", "トピック2")).toBe("—");
  });

  it("古い形式のトピックは束ねている知見へのリンクも生成元として数えない", () => {
    const files = [file("t1", "トピック1")];
    const metas = new Map<string, WikiMetaSummary>([
      ["t1", { title: "トピック1", kind: "topic", derivedFromClaims: ["c1", "c2"] }],
    ]);
    const noteIndex = {
      notes: [entry("t1", [], ["c1", "c2", "note-x"])],
    } as unknown as GraphiumIndex;
    render(
      <LocaleProvider>
        <WikiListView
          noteIndex={noteIndex}
          wikiKind="topic"
          wikiFiles={files}
          wikiMetas={metas}
          onOpenWiki={() => {}}
          onBack={() => {}}
          onDeleteWiki={async () => {}}
        />
      </LocaleProvider>,
    );
    expect(linksCell("トピック1")).toBe("1");
  });
});

/** 見出しが label で始まる列の、指定タイトルの行のセルの文字 */
function cellUnder(label: string, title: string): string {
  const headers = [...document.querySelectorAll("thead th")];
  const col = headers.findIndex((th) => th.textContent?.startsWith(label));
  expect(col).toBeGreaterThan(-1);
  const row = screen.getByText(title).closest("tr")!;
  return row.querySelectorAll("td")[col].textContent ?? "";
}

describe("WikiListView 生成元列（洞察）", () => {
  it("洞察はもとになった知見の件数を出す（生成元のノートを持たないので、ノート数では全行が空になる）", () => {
    const files = [file("a1", "洞察1"), file("a2", "洞察2")];
    const metas = new Map<string, WikiMetaSummary>([
      ["a1", { title: "洞察1", kind: "atom", derivedFromClaims: ["c1", "c2", "c3"] }],
      ["a2", { title: "洞察2", kind: "atom", derivedFromClaims: ["c1"] }],
    ]);
    const noteIndex = {
      notes: [entry("a1", [], ["c1", "c2", "c3"]), entry("a2", [], ["c1"])],
    } as unknown as GraphiumIndex;
    render(
      <LocaleProvider>
        <WikiListView
          noteIndex={noteIndex}
          wikiKind="atom"
          wikiFiles={files}
          wikiMetas={metas}
          onOpenWiki={() => {}}
          onBack={() => {}}
          onDeleteWiki={async () => {}}
        />
      </LocaleProvider>,
    );
    expect(cellUnder("Sources", "洞察1")).toBe("3");
    expect(cellUnder("Sources", "洞察2")).toBe("1");
    // もとの知見へのリンクは「リンク」には数えない。どの洞察にも値が無いので、リンクと被参照は
    // 列ごと出さない（「—」だけの列を並べない）
    const headers = [...document.querySelectorAll("thead th")].map((th) => th.textContent ?? "");
    expect(headers.some((h) => h.startsWith("Links"))).toBe(false);
    expect(headers.some((h) => h.startsWith("Refs in"))).toBe(false);
  });
});
