// @vitest-environment jsdom
// WikiListView の「出典」列（Source check, v1.1 / 仕様 2-c）のテスト。
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WikiListView } from "./WikiListView";
import { LocaleProvider } from "../../i18n";
import type { GraphiumFile, WikiMetaSummary } from "../../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

function file(id: string, name: string): GraphiumFile {
  return { id, name, modifiedTime: "2026-01-01T00:00:00Z", createdTime: "2026-01-01T00:00:00Z" };
}

function renderList(wikiKind: "claim" | "topic" | "synthesis", metas: Map<string, WikiMetaSummary>, files: GraphiumFile[]) {
  return render(
    <LocaleProvider>
      <WikiListView
        noteIndex={null}
        wikiKind={wikiKind}
        wikiFiles={files}
        wikiMetas={metas}
        onOpenWiki={() => {}}
        onBack={() => {}}
        onDeleteWiki={async () => {}}
      />
    </LocaleProvider>,
  );
}

describe("WikiListView 出典列", () => {
  it("claim 一覧には「出典」列と verdict ラベルが出る", () => {
    const files = [file("c1", "知見1")];
    const metas = new Map<string, WikiMetaSummary>([
      [
        "c1",
        {
          title: "知見1",
          kind: "claim",
          sourceCheckVerdict: { verdict: "supported", claimHash: "sha256:x" },
        },
      ],
    ]);
    renderList("claim", metas, files);
    expect(screen.getByText("Source check")).toBeTruthy();
    expect(screen.getByText("Found in source")).toBeTruthy();
  });

  it("topic 一覧にも「出典」列が出る（世界照合列とは逆に topic を含む）", () => {
    const files = [file("t1", "トピック1")];
    const metas = new Map<string, WikiMetaSummary>([
      [
        "t1",
        {
          title: "トピック1",
          kind: "topic",
          sourceCheckVerdict: { verdict: "not-in-source", claimHash: "sha256:x" },
        },
      ],
    ]);
    renderList("topic", metas, files);
    expect(screen.getByText("Source check")).toBeTruthy();
    expect(screen.getByText("Not in source")).toBeTruthy();
  });

  it("未照合（sourceCheckVerdict 無し）は — を出す", () => {
    const files = [file("c1", "知見1")];
    const metas = new Map<string, WikiMetaSummary>([["c1", { title: "知見1", kind: "claim" }]]);
    renderList("claim", metas, files);
    expect(screen.getByText("Source check")).toBeTruthy();
    expect(screen.queryByText("Found in source")).toBeNull();
  });

  it("synthesis 一覧には「出典」列が出ない（claim/topic 以外は対象外）", () => {
    const files = [file("s1", "発想1")];
    const metas = new Map<string, WikiMetaSummary>([
      ["s1", { title: "発想1", kind: "synthesis" }],
    ]);
    renderList("synthesis", metas, files);
    expect(screen.queryByText("Source check")).toBeNull();
  });
});
