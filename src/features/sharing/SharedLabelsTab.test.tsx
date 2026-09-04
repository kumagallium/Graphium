// @vitest-environment jsdom
// Library「ラベル」タブのテスト。
//
// 対象の不変条件:
// - チップの件数がギャラリーの行数と一致する（FileSidebar と同じ数え方 =
//   block preview / インラインの文字列 / 工程名のユニーク数。数字と行数がずれると
//   どちらが本当か分からなくなる）
// - チップで種別を切り替えるとギャラリーの中身も切り替わる
// - 戻るボタンは出さない（切り替え導線はチップが担う）
// - 投影がまだ無いノートは数にも一覧にも出ない（読めた分だけ増える）

import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup, within } from "@testing-library/react";
import { SharedLabelsTab } from "./SharedLabelsTab";
import {
  createEmptySharedProjection,
  projectSharedNote,
  type SharedProjection,
} from "./shared-projection";
import { LocaleProvider, t, getDisplayLabelName } from "../../i18n";
import type { GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const styled = (text: string, styles: Record<string, string | boolean> = {}) => ({
  type: "text",
  text,
  styles,
});
const para = (id: string, content: any[]) => ({ id, type: "paragraph", content, children: [] });
const step = (id: string, title: string, children: any[] = []) => ({
  id,
  type: "step",
  content: [styled(title)],
  children,
});
const doc = (blocks: any[], title: string): GraphiumDocument =>
  ({
    version: 6,
    title,
    pages: [{ id: "p1", title, blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
  }) as any;

function sharedNote(id: string, title: string): SharedEntry {
  return {
    id,
    type: "note",
    author: { name: "Ada", email: "ada@example.com" },
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    hash: `sha256:${id}`,
    prov: { derived_from: [] },
    version: 1,
    extra: { title },
  };
}

const NOTE_A = sharedNote("s-a", "焼成の記録");
const NOTE_B = sharedNote("s-b", "粉砕の記録");

// procedure: 焼成 / 粉砕 = 2、material: 前駆体粉末 / アルミナ = 2、tool: 電気炉 = 1
const DOC_A = doc(
  [
    step("a-s1", "焼成", [
      para("a-b1", [styled("前駆体粉末", { inlineMaterial: "m1" })]),
      para("a-b2", [styled("電気炉", { inlineTool: "t1" })]),
    ]),
  ],
  "焼成の記録",
);
const DOC_B = doc(
  [
    step("b-s1", "粉砕", [
      para("b-b1", [styled("前駆体粉末", { inlineMaterial: "m1" })]),
      para("b-b2", [styled("アルミナ", { inlineMaterial: "m2" })]),
    ]),
  ],
  "粉砕の記録",
);

function projectionOf(...pairs: [SharedEntry, GraphiumDocument][]): SharedProjection {
  const projection = createEmptySharedProjection();
  for (const [entry, d] of pairs) projection.entries[entry.id] = projectSharedNote(entry, d);
  return projection;
}

function renderTab(projection: SharedProjection, entries: SharedEntry[] = [NOTE_A, NOTE_B]) {
  return render(
    <LocaleProvider>
      <SharedLabelsTab projection={projection} entries={entries} onNavigateNote={() => {}} />
    </LocaleProvider>,
  );
}

/** 種別チップ（aria-pressed を持つボタン）を表示名で引く */
function chip(container: HTMLElement, label: string): HTMLElement {
  const hit = [...container.querySelectorAll("button[aria-pressed]")].find((b) =>
    b.textContent?.includes(getDisplayLabelName(label)),
  );
  if (!hit) throw new Error(`chip not found: ${label}`);
  return hit as HTMLElement;
}

afterEach(cleanup);

describe("SharedLabelsTab", () => {
  it("種別チップの件数がギャラリーの行数と一致する", () => {
    const { container } = renderTab(projectionOf([NOTE_A, DOC_A], [NOTE_B, DOC_B]));

    expect(chip(container, "material").textContent).toContain("2");
    expect(chip(container, "procedure").textContent).toContain("2");
    expect(chip(container, "tool").textContent).toContain("1");

    // 初期表示は件数が最も多い種別（同数なら名前順 = material）
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);
    const previews = [...rows].map((r) => r.querySelector("td")?.textContent);
    expect(previews).toEqual(expect.arrayContaining(["前駆体粉末", "アルミナ"]));
  });

  it("チップを切り替えるとその種別の一覧になる", () => {
    const { container } = renderTab(projectionOf([NOTE_A, DOC_A], [NOTE_B, DOC_B]));

    fireEvent.click(chip(container, "procedure"));

    const previews = [...container.querySelectorAll("tbody tr")].map(
      (r) => r.querySelector("td")?.textContent,
    );
    expect(previews).toEqual(expect.arrayContaining(["焼成", "粉砕"]));
    expect(previews).not.toContain("アルミナ");
  });

  it("戻るボタンは出さない（切り替えはチップが担う）", () => {
    const { queryByText } = renderTab(projectionOf([NOTE_A, DOC_A]));
    expect(queryByText(t("common.back"))).toBeNull();
  });

  it("まだ投影されていない共有ノートは数にも一覧にも出ない", () => {
    // NOTE_B は共有されているが本文をまだ読めていない状態
    const { container } = renderTab(projectionOf([NOTE_A, DOC_A]));

    expect(chip(container, "procedure").textContent).toContain("1");
    const table = container.querySelector("table");
    expect(table && within(table).queryByText("粉砕")).toBeNull();
  });

  it("投影が空なら空表示を出す", () => {
    const { getByText, container } = renderTab(createEmptySharedProjection());
    expect(getByText(t("library.empty.labels"))).toBeTruthy();
    expect(container.querySelector("button[aria-pressed]")).toBeNull();
  });
});
