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
