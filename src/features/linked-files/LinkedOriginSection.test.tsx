// @vitest-environment jsdom
// 「元データ」の節。文言は既定の en で照合する。
// - 出る条件（対象外・リンクした素材が無いときは出ない）
// - 指定済みの一覧・行を押すと移動・外す
// - 選ぶ画面から追加できる（名前で絞り込める）

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import type { MediaIndex, MediaIndexEntry } from "../asset-browser/media-index";
import { LinkedOriginSection, shouldShowLinkedOrigin } from "./LinkedOriginSection";
import { buildPlaceUrl } from "./link-url";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => cleanup());

const base = { thumbnailUrl: "", uploadedAt: "2026-11-01T00:00:00.000Z", usedIn: [] };
function linked(fileId: string, name: string, over: Partial<MediaIndexEntry> = {}): MediaIndexEntry {
  const relPath = `raw/${name}`;
  return {
    ...base,
    fileId,
    name,
    type: "url",
    mimeType: "text/x-uri",
    url: buildPlaceUrl("p1", relPath),
    urlMeta: { domain: "Lab drive", description: relPath },
    link: { placeId: "p1", relPath, size: 1, mtimeMs: 1, recordedAt: "2026-11-01T00:00:00.000Z" },
    ...over,
  };
}
const child = (over: Partial<MediaIndexEntry> = {}): MediaIndexEntry => ({
  ...base,
  fileId: "d1",
  name: "summary.csv",
  type: "data",
  mimeType: "text/csv",
  url: "/m/d1",
  ...over,
});
const idx = (...media: MediaIndexEntry[]): MediaIndex => ({ version: 5, updatedAt: "2026-11-01T00:00:00.000Z", media }) as MediaIndex;

describe("shouldShowLinkedOrigin（出る条件）", () => {
  it("リンクした素材が無く、指定済みも無いときは出さない", () => {
    expect(shouldShowLinkedOrigin(child(), idx(child()))).toBe(false);
  });
  it("リンクした素材があれば出す", () => {
    expect(shouldShowLinkedOrigin(child(), idx(child(), linked("l1", "raw.csv")))).toBe(true);
  });
  it("リンクした素材がアーカイブ済みだけでも、指定済みなら出す", () => {
    const l = linked("l1", "raw.csv", { archivedAt: "2026-11-02T00:00:00.000Z" });
    const c = child({ derivedFromAssets: ["l1"] });
    expect(shouldShowLinkedOrigin(c, idx(c, l))).toBe(true);
    expect(shouldShowLinkedOrigin(child(), idx(child(), l))).toBe(false);
  });
  it("メモ・リンクした素材・索引なしでは出さない", () => {
    const l = linked("l1", "raw.csv");
    expect(shouldShowLinkedOrigin(child({ type: "memo" }), idx(l))).toBe(false);
    expect(shouldShowLinkedOrigin(l, idx(l))).toBe(false);
    expect(shouldShowLinkedOrigin(child(), null)).toBe(false);
  });
});

function setup(index: MediaIndex, entry = child(), withSwitch = true) {
  const persist = vi.fn(async () => true);
  const onSwitchAsset = vi.fn();
  render(
    <LocaleProvider>
      <LinkedOriginSection
        entry={entry}
        mediaIndex={index}
        onSwitchAsset={withSwitch ? onSwitchAsset : undefined}
        __test={{ persist }}
      />
    </LocaleProvider>,
  );
  return { persist, onSwitchAsset };
}

describe("LinkedOriginSection", () => {
  it("指定済みの元データの名前・置き場・場所を出し、押すとその素材へ移る", () => {
    const l = linked("l1", "raw.csv");
    const c = child({ derivedFromAssets: ["l1", "gone"] });
    const { onSwitchAsset } = setup(idx(c, l), c);
    expect(screen.getByText("Lab drive / raw/raw.csv")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to “raw.csv”" }));
    expect(onSwitchAsset).toHaveBeenCalledWith(l);
  });

  it("外すボタンで 1 件ずつ外れ、保存を呼ぶ", () => {
    const c = child({ derivedFromAssets: ["l1", "l2"] });
    const { persist } = setup(idx(c, linked("l1", "a.csv"), linked("l2", "b.csv")), c);
    fireEvent.click(screen.getByRole("button", { name: "Remove “a.csv” from source data" }));
    expect(persist).toHaveBeenCalledWith("d1", { remove: ["l1"] });
    expect(screen.queryByText("a.csv")).toBeNull();
    expect(screen.getByText("b.csv")).toBeTruthy();
  });

  it("指定が無いときは「指定していません」を出し、ボタンから選んで追加できる（名前で絞り込める）", () => {
    const { persist } = setup(idx(child(), linked("l1", "alpha.csv"), linked("l2", "beta.csv")));
    expect(screen.getByText("Not set")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Set source data" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("Filter by name"), { target: { value: "bet" } });
    expect(within(dialog).queryByText(/alpha\.csv/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("menuitemcheckbox", { name: /beta\.csv/ }));
    expect(persist).toHaveBeenCalledWith("d1", { add: ["l2"], remove: [] });
    expect(screen.getAllByText("beta.csv").length).toBeGreaterThan(0);
  });

  it("移動の導線が無いときは名前を押せない", () => {
    const c = child({ derivedFromAssets: ["l1"] });
    setup(idx(c, linked("l1", "raw.csv")), c, false);
    expect(screen.queryByRole("button", { name: /Go to/ })).toBeNull();
    expect(screen.getByText("raw.csv")).toBeTruthy();
  });
});
