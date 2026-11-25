// @vitest-environment jsdom
// ホームの入れ物が、索引の editedAt から書き換えた日ごとに更新の行を並べ、押すとそのノートを開く。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import { dayKeyOf, updatedRowId } from "./model";
import { __resetRecordsViewResumeForTest, RecordsView } from "./RecordsView";

/** 今日から n 日前の、端末の時刻帯での正午 */
function daysAgo(n: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

const CREATED = daysAgo(5);
const EDIT_1 = daysAgo(3);
const EDIT_2 = daysAgo(1);

const NOTE = {
  noteId: "own-2",
  title: "食パンの試作",
  createdAt: CREATED,
  modifiedAt: EDIT_2,
  editedAt: [EDIT_1, EDIT_2],
  headings: [],
  labels: [],
  outgoingLinks: [],
} as unknown as NoteIndexEntry;

beforeEach(() => {
  __resetRecordsViewResumeForTest();
});

afterEach(() => {
  cleanup();
});

describe("書き換えた日ごとの更新の行", () => {
  it("書き換えた 2 日のそれぞれに更新の行が並び、作成の行は作った日に残る", () => {
    render(
      <LocaleProvider>
        <RecordsView
          noteIndex={{ notes: [NOTE] } as unknown as GraphiumIndex}
          mediaIndex={null}
          captureIndex={null}
          onOpenNote={vi.fn()}
          onOpenMedia={vi.fn()}
          onOpenMemo={vi.fn()}
        />
      </LocaleProvider>,
    );
    const ids = [...document.querySelectorAll("[data-record-id]")].map((el) => el.getAttribute("data-record-id"));
    expect(ids).toEqual([
      updatedRowId("own-2", dayKeyOf(EDIT_2)),
      updatedRowId("own-2", dayKeyOf(EDIT_1)),
      "note:own-2",
    ]);
  });

  it("前の日の更新の行を押しても、そのノートを開く", () => {
    const onOpenNote = vi.fn();
    render(
      <LocaleProvider>
        <RecordsView
          noteIndex={{ notes: [NOTE] } as unknown as GraphiumIndex}
          mediaIndex={null}
          captureIndex={null}
          onOpenNote={onOpenNote}
          onOpenMedia={vi.fn()}
          onOpenMemo={vi.fn()}
        />
      </LocaleProvider>,
    );
    fireEvent.click(document.querySelector(`[data-record-id="${updatedRowId("own-2", dayKeyOf(EDIT_1))}"]`) as HTMLElement);
    expect(onOpenNote).toHaveBeenCalledWith("own-2", false);
  });
});
