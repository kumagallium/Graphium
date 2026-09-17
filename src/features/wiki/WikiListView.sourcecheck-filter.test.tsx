// @vitest-environment jsdom
// WikiListView の「要確認のみ」フィルタ（Source check, v1.1）のテスト。
// 既定は全件表示。claim/topic 以外では出さない。

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { WikiListView } from "./WikiListView";
import { LocaleProvider, t } from "../../i18n";
import type { GraphiumFile, WikiMetaSummary } from "../../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

function file(id: string): GraphiumFile {
  return { id, name: id, modifiedTime: "2026-01-01T00:00:00Z", createdTime: "2026-01-01T00:00:00Z" };
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

describe("WikiListView 要確認のみフィルタ", () => {
  it("claim 一覧にフィルタチェックボックスが出て、既定は全件表示", () => {
    const files = [file("c1"), file("c2")];
    const metas = new Map<string, WikiMetaSummary>([
      ["c1", { title: "知見1(要確認)", kind: "claim", sourceCheckVerdict: { verdict: "contradicted", claimHash: "h" } }],
      ["c2", { title: "知見2(問題なし)", kind: "claim", sourceCheckVerdict: { verdict: "supported", claimHash: "h" } }],
    ]);
    renderList("claim", metas, files);
    expect(screen.getByLabelText(t("wikiList.filterSourceCheckNeedsReviewOnly"))).toBeTruthy();
    expect(screen.getByText("知見1(要確認)")).toBeTruthy();
    expect(screen.getByText("知見2(問題なし)")).toBeTruthy();
  });

  it("チェックすると要確認（contradicted/not-in-source かつ未確認）だけに絞られる", () => {
    const files = [file("c1"), file("c2"), file("c3")];
    const metas = new Map<string, WikiMetaSummary>([
      ["c1", { title: "知見1(要確認)", kind: "claim", sourceCheckVerdict: { verdict: "contradicted", claimHash: "h" } }],
      ["c2", { title: "知見2(問題なし)", kind: "claim", sourceCheckVerdict: { verdict: "supported", claimHash: "h" } }],
      ["c3", { title: "知見3(確認済み)", kind: "claim", sourceCheckVerdict: { verdict: "not-in-source", dismissed: true, claimHash: "h" } }],
    ]);
    renderList("claim", metas, files);
    fireEvent.click(screen.getByLabelText(t("wikiList.filterSourceCheckNeedsReviewOnly")));
    expect(screen.getByText("知見1(要確認)")).toBeTruthy();
    expect(screen.queryByText("知見2(問題なし)")).toBeNull();
    expect(screen.queryByText("知見3(確認済み)")).toBeNull();
  });

  it("topic 一覧にもフィルタが出る", () => {
    const files = [file("t1")];
    const metas = new Map<string, WikiMetaSummary>([
      ["t1", { title: "トピック1", kind: "topic", sourceCheckVerdict: { verdict: "not-in-source", claimHash: "h" } }],
    ]);
    renderList("topic", metas, files);
    expect(screen.getByLabelText(t("wikiList.filterSourceCheckNeedsReviewOnly"))).toBeTruthy();
  });

  it("synthesis 一覧にはフィルタが出ない（claim/topic 以外は対象外）", () => {
    const files = [file("s1")];
    const metas = new Map<string, WikiMetaSummary>([["s1", { title: "発想1", kind: "synthesis" }]]);
    renderList("synthesis", metas, files);
    expect(screen.queryByLabelText(t("wikiList.filterSourceCheckNeedsReviewOnly"))).toBeNull();
  });
});
