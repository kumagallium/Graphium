// @vitest-environment jsdom
// リンクした素材 1 件の表示。文言は既定の en で照合する。
// - 5 つの状態ごとの表示と、開く・場所を表示のボタンの押せる・押せない
// - 変わっているとき: 控えといまを並べ、「いまの状態を控え直す」で persistLinkPatch が呼ばれる
// - 確かめ直すで statLinks を呼び直す
// - 控え直しの履歴は折りたたみで出す

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import { LinkedFileView, type LinkedFileViewProps } from "./LinkedFileView";
import { buildPlaceUrl } from "./link-url";
import type { LinkStat } from "./places";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => cleanup());

const RECORDED = "2026-11-10T09:00:00.000Z";
const MTIME = Date.UTC(2026, 10, 9, 12, 0, 0);

function entry(over: Partial<NonNullable<MediaIndexEntry["link"]>> = {}): MediaIndexEntry {
  return {
    fileId: "url_1",
    name: "Dough hydration.xlsx",
    type: "url",
    mimeType: "text/x-uri",
    url: buildPlaceUrl("p1", "Recipes/Dough hydration.xlsx"),
    thumbnailUrl: "",
    uploadedAt: RECORDED,
    usedIn: [],
    urlMeta: { domain: "Whole bakery", description: "Recipes/Dough hydration.xlsx" },
    link: { placeId: "p1", relPath: "Recipes/Dough hydration.xlsx", size: 2048, mtimeMs: MTIME, recordedAt: RECORDED, ...over },
  };
}

function setup(stat: LinkStat, e: MediaIndexEntry = entry()) {
  const fns = {
    statLinks: vi.fn(async (items: { placeId: string; relPath: string }[]) => items.map(() => stat)),
    listPlaces: vi.fn(async () => [{ id: "p1", name: "Whole bakery", root: "/x", reachable: true, shared: true }]),
    openLinkedFile: vi.fn(async () => {}),
    revealLinkedFile: vi.fn(async () => {}),
    persistLinkPatch: vi.fn(async () => true),
  } satisfies NonNullable<LinkedFileViewProps["__test"]>;
  render(
    <LocaleProvider>
      <LinkedFileView entry={e} __test={fns} />
    </LocaleProvider>,
  );
  return fns;
}

const openBtn = () => screen.getByRole("button", { name: "Open the original" }) as HTMLButtonElement;
const revealBtn = () => screen.getByRole("button", { name: "Show in folder" }) as HTMLButtonElement;

describe("LinkedFileView", () => {
  it("名前・置き場・場所・大きさを出す", async () => {
    setup({ state: "ok", size: 2048, mtimeMs: MTIME });
    await screen.findByText("No change");
    expect(screen.getByText("Dough hydration.xlsx")).toBeTruthy();
    expect(screen.getByText("Whole bakery")).toBeTruthy();
    expect(screen.getByText("Recipes/Dough hydration.xlsx")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
  });

  it("変わりなし: 開く・場所を表示を押せる", async () => {
    const fns = setup({ state: "ok", size: 2048, mtimeMs: MTIME });
    await screen.findByText("No change");
    expect(openBtn().disabled).toBe(false);
    expect(revealBtn().disabled).toBe(false);
    fireEvent.click(openBtn());
    await waitFor(() => expect(fns.openLinkedFile).toHaveBeenCalledWith("p1", "Recipes/Dough hydration.xlsx"));
    fireEvent.click(revealBtn());
    await waitFor(() => expect(fns.revealLinkedFile).toHaveBeenCalledWith("p1", "Recipes/Dough hydration.xlsx"));
    expect(screen.queryByRole("button", { name: "Record the current state" })).toBeNull();
  });

  it("変わっている: 控えといまを並べ、開くは押せる。控え直しで persistLinkPatch が呼ばれ、履歴に積む", async () => {
    const fns = setup({ state: "ok", size: 4096, mtimeMs: MTIME + 60_000 });
    await screen.findByText("The original has changed");
    expect(openBtn().disabled).toBe(false);
    const compare = screen.getByTestId("linked-file-compare");
    expect(compare.textContent).toContain("2.0 KB");
    expect(compare.textContent).toContain("4.0 KB");

    fireEvent.click(screen.getByRole("button", { name: "Record the current state" }));
    await waitFor(() => expect(fns.persistLinkPatch).toHaveBeenCalledTimes(1));
    const [fileId, link] = fns.persistLinkPatch.mock.calls[0] as unknown as [string, NonNullable<MediaIndexEntry["link"]>];
    expect(fileId).toBe("url_1");
    expect(link.size).toBe(4096);
    expect(link.mtimeMs).toBe(MTIME + 60_000);
    expect(link.history).toHaveLength(1);
    expect(link.history![0]).toMatchObject({ size: 2048, mtimeMs: MTIME, recordedAt: RECORDED });
    // 控え直したあとは「変わりなし」になる
    await screen.findByText("No change");
    expect(screen.queryByTestId("linked-file-compare")).toBeNull();
  });

  it.each([
    ["missing", "The original can't be found"],
    ["unreachable", "Can't reach the place"],
    ["unregistered", "Not registered on this device"],
  ] as const)("%s: 状態を出し、開く・場所を表示を押せなくする", async (state, label) => {
    const fns = setup({ state });
    await screen.findByText(label);
    expect(openBtn().disabled).toBe(true);
    expect(revealBtn().disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Record the current state" })).toBeNull();
    fireEvent.click(openBtn());
    expect(fns.openLinkedFile).not.toHaveBeenCalled();
  });

  it("「確かめ直す」で statLinks を呼び直し、結果を反映する", async () => {
    const fns = setup({ state: "ok", size: 2048, mtimeMs: MTIME });
    await screen.findByText("No change");
    expect(fns.statLinks).toHaveBeenCalledTimes(1);
    fns.statLinks.mockImplementation(async (items) => items.map(() => ({ state: "missing" as const })));
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await screen.findByText("The original can't be found");
    expect(fns.statLinks).toHaveBeenCalledTimes(2);
  });

  it("控え直しの履歴があれば折りたたみで出す。無ければ出さない", async () => {
    const history = [{ size: 1024, mtimeMs: MTIME - 1000, recordedAt: "2026-11-01T09:00:00.000Z" }];
    setup({ state: "ok", size: 2048, mtimeMs: MTIME }, entry({ history }));
    await screen.findByText("No change");
    const details = screen.getByTestId("linked-file-history") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("History of records (1)");
    cleanup();
    setup({ state: "ok", size: 2048, mtimeMs: MTIME });
    await screen.findByText("No change");
    expect(screen.queryByTestId("linked-file-history")).toBeNull();
  });
});
