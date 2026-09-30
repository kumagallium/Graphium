// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { NoteOriginPicker } from "./note-origin-picker";

afterEach(cleanup);

describe("NoteOriginPicker の外側クリック", () => {
  it("portal 先の一覧内クリックでは閉じず、外側クリックで閉じる", () => {
    const { container } = render(
      <LocaleProvider><NoteOriginPicker index={null} value={null} onChange={() => {}} /></LocaleProvider>,
    );
    fireEvent.click(container.querySelector("button")!);
    const list = () => document.body.querySelector('[role="listbox"]');
    expect(list()).not.toBeNull();
    fireEvent.mouseDown(list()!);
    expect(list()).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(list()).toBeNull();
  });
});
