// @vitest-environment jsdom
// 日の中は新しい順。まとめ行の時刻は、遅い時刻を上・早い時刻を下に出す。
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { RecordDay } from "./RecordDay";
import { formatTime, groupByDay } from "./model";
import type { RecordItem } from "./types";

const NOW = "2026-11-17T22:00:00";

const note = (id: string, hour: number): RecordItem => ({
  id,
  kind: "note",
  at: `2026-11-17T${String(hour).padStart(2, "0")}:00:00`,
  origin: "written",
  who: { type: "self" },
  title: `ノート ${id}`,
});

afterEach(cleanup);

describe("日の中の並び", () => {
  it("新しい記録が上に来る", () => {
    const [day] = groupByDay([note("a", 9), note("b", 17), note("c", 13)]);
    render(
      <LocaleProvider>
        <RecordDay dayKey={day.key} items={day.items} now={NOW} bundleMin={0} />
      </LocaleProvider>,
    );
    const ids = [...document.querySelectorAll("[data-record-id]")].map((el) => el.getAttribute("data-record-id"));
    expect(ids).toEqual(["b", "c", "a"]);
  });

  it("まとめ行の時刻は、遅い時刻が上・早い時刻が下", () => {
    const [day] = groupByDay([9, 10, 11, 12, 13, 14].map((h) => note(`n${h}`, h)));
    render(
      <LocaleProvider>
        <RecordDay dayKey={day.key} items={day.items} now={NOW} bundleMin={6} />
      </LocaleProvider>,
    );
    const time = document.querySelector(".rd-bundle .rd-time") as HTMLElement;
    const to = time.querySelector(".rd-time-to") as HTMLElement;
    expect(time.getAttribute("datetime")).toBe("2026-11-17T14:00:00");
    expect(time.textContent?.startsWith(formatTime("2026-11-17T14:00:00"))).toBe(true);
    expect(to.textContent).toBe(formatTime("2026-11-17T09:00:00"));
  });
});
