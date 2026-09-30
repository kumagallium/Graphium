// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { NoteListToolbar } from "./NoteListToolbar";

afterEach(cleanup);

function setup() {
  return render(
    <LocaleProvider><NoteListToolbar
      sortKey="updatedAt"
      sortDir="desc"
      onSort={() => {}}
      searchQuery=""
      onSearchChange={() => {}}
      sortOptions={[
        { key: "updatedAt", labelKey: "a" },
        { key: "title", labelKey: "b" },
      ]}
    /></LocaleProvider>,
  );
}

describe("並べ替えメニューの再押下", () => {
  it("開いたあとにもう一度押すと閉じる", () => {
    const { container } = setup();
    const btn = container.querySelector("button")!;
    const open = () => document.body.querySelector("div.fixed") !== null;
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    expect(open()).toBe(true);
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    expect(open()).toBe(false);
  });
});
