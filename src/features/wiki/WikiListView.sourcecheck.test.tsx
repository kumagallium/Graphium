// @vitest-environment jsdom
// WikiListView の「出典」列（Source check, v1.1 / 仕様 2-c）のテスト。
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
  // dev は StrictMode で更新関数を 2 回呼ぶ。並べ替えの更新関数の中で向きを反転していた頃は
  // 2 回反転して元に戻り、同じ見出しを 2 回押しても向きが変わらなかった（本番ビルドでは効く）
  it("StrictMode でも「出典」見出しを 2 回押すと向きが変わる", () => {
    const files = [file("c1", "知見1"), file("c2", "知見2")];
    const metas = new Map<string, WikiMetaSummary>([
      ["c1", { title: "知見1", kind: "claim", sourceCheckVerdict: { verdict: "supported", claimHash: "h1" } }],
      ["c2", { title: "知見2", kind: "claim", sourceCheckVerdict: { verdict: "contradicted", claimHash: "h2" } }],
    ]);
    render(
      <StrictMode>
        <LocaleProvider>
          <WikiListView
            noteIndex={null}
            wikiKind="claim"
            wikiFiles={files}
            wikiMetas={metas}
            onOpenWiki={() => {}}
            onBack={() => {}}
            onDeleteWiki={async () => {}}
          />
        </LocaleProvider>
      </StrictMode>,
    );
    const header = () => screen.getByText((_, el) => el?.tagName === "TH" && /^Source check/.test(el.textContent ?? ""));
    fireEvent.click(header());
    expect(header().textContent).toBe("Source check ↓");
    fireEvent.click(header());
    expect(header().textContent).toBe("Source check ↑");
    fireEvent.click(header());
    expect(header().textContent).toBe("Source check ↓");
  });
});
