// @vitest-environment jsdom
// ホームの入れ物が、共有フォルダの封筒を「共有の作者」の記録として並べ、押すと開く。
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SharedEntry } from "../../lib/storage/shared";
import { LocaleProvider, t } from "../../i18n";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import { __resetRecordsViewResumeForTest, RecordsView, type RecordsViewProps } from "./RecordsView";

function shared(id: string, email: string, over: Partial<SharedEntry> = {}): SharedEntry {
  return {
    id,
    type: "note",
    author: { name: email.split("@")[0], email },
    created_at: "2026-11-20T00:00:00Z",
    updated_at: "2026-11-21T03:00:00Z",
    hash: `sha256:${id}`,
    prov: { derived_from: [] },
    extra: { title: `題 ${id}` },
    ...over,
  } as SharedEntry;
}

const ENTRIES = [
  shared("rec-1", "sato@example.com", {
    extra: { title: "一次発酵の記録", planRow: { planIds: ["plan-1"], tableBlockId: "t1", rowId: "r1", rowName: "一次発酵" } },
  }),
  shared("mine-1", "me@example.com"),
];

const OWN_NOTE = {
  noteId: "own-1",
  title: "自分のノート",
  createdAt: "2026-11-21T01:00:00Z",
  modifiedAt: "2026-11-21T01:00:00Z",
  headings: [],
  labels: [],
} as unknown as NoteIndexEntry;

function renderView(over: Partial<RecordsViewProps> = {}) {
  const onOpenShared = vi.fn();
  const view = render(
    <LocaleProvider>
      <RecordsView
        noteIndex={{ notes: [OWN_NOTE] } as unknown as GraphiumIndex}
        mediaIndex={null}
        captureIndex={null}
        onOpenNote={vi.fn()}
        onOpenMedia={vi.fn()}
        onOpenMemo={vi.fn()}
        onOpenShared={onOpenShared}
        selfEmail="me@example.com"
        sharedLibrary={{ entries: ENTRIES, derived: {} }}
        {...over}
      />
    </LocaleProvider>,
  );
  return { onOpenShared, ...view };
}

const rowIds = () => [...document.querySelectorAll("[data-record-id]")].map((el) => el.getAttribute("data-record-id"));
const otherButton = () => screen.getByRole("button", { name: t("records.whoFilter.other") });

beforeEach(() => {
  __resetRecordsViewResumeForTest();
});

afterEach(() => {
  cleanup();
});

describe("ホームに並ぶ共有フォルダの記録", () => {
  it("「共有の作者」に切り替えると、ほかの人の記録だけが並ぶ（自分が共有したものは出ない）", () => {
    renderView();
    expect(rowIds()).toEqual(["note:own-1"]);
    fireEvent.click(otherButton());
    expect(rowIds()).toEqual(["shared:rec-1"]);
  });

  it("行を押すと、共有エントリの id で onOpenShared が呼ばれる", () => {
    const { onOpenShared } = renderView();
    fireEvent.click(otherButton());
    fireEvent.click(document.querySelector('[data-record-id="shared:rec-1"]') as HTMLElement);
    expect(onOpenShared).toHaveBeenCalledWith("rec-1");
  });

  it("開く先（onOpenShared）が無いときは、共有フォルダの記録を並べない", () => {
    renderView({ onOpenShared: undefined });
    fireEvent.click(otherButton());
    expect(rowIds()).toEqual([]);
  });

  it("共有の記録を開いたあとでも、探す言葉を持って開いたときは「すべて」から始まる", () => {
    const first = renderView();
    fireEvent.click(otherButton());
    fireEvent.click(document.querySelector('[data-record-id="shared:rec-1"]') as HTMLElement);
    first.unmount();

    const second = renderView({ initialQuery: "自分" });
    expect(otherButton().getAttribute("aria-pressed")).toBe("false");
    second.unmount();

    // 旗は使わなかったときも下ろす
    renderView();
    expect(otherButton().getAttribute("aria-pressed")).toBe("false");
  });

  it("続きから始めたあとに探す言葉が替わったら、「すべて」から作り直す（StrictMode でも同じ）", () => {
    const first = renderView();
    fireEvent.click(otherButton());
    fireEvent.click(document.querySelector('[data-record-id="shared:rec-1"]') as HTMLElement);
    first.unmount();

    const props: RecordsViewProps = {
      noteIndex: { notes: [OWN_NOTE] } as unknown as GraphiumIndex,
      mediaIndex: null,
      captureIndex: null,
      onOpenNote: vi.fn(),
      onOpenMedia: vi.fn(),
      onOpenMemo: vi.fn(),
      onOpenShared: vi.fn(),
      selfEmail: "me@example.com",
      sharedLibrary: { entries: ENTRIES, derived: {} },
    };
    const tree = (query: string) => (
      <StrictMode>
        <LocaleProvider>
          <RecordsView {...props} initialQuery={query} />
        </LocaleProvider>
      </StrictMode>
    );
    const view = render(tree(""));
    expect(otherButton().getAttribute("aria-pressed")).toBe("true");
    view.rerender(tree("自分"));
    expect(otherButton().getAttribute("aria-pressed")).toBe("false");
    // 言葉を消しても、続きには戻らない
    view.rerender(tree(""));
    expect(otherButton().getAttribute("aria-pressed")).toBe("false");
  });

  it("共有の記録を開いたあと、次にホームを開くと 1 回だけ「共有の作者」から始まる", () => {
    const first = renderView();
    fireEvent.click(otherButton());
    fireEvent.click(document.querySelector('[data-record-id="shared:rec-1"]') as HTMLElement);
    first.unmount();

    const second = renderView();
    expect(otherButton().getAttribute("aria-pressed")).toBe("true");
    expect(rowIds()).toEqual(["shared:rec-1"]);
    second.unmount();

    renderView();
    expect(otherButton().getAttribute("aria-pressed")).toBe("false");
    expect(rowIds()).toEqual(["note:own-1"]);
  });
});
