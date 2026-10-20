// @vitest-environment jsdom
// 「+ ノート」分割ボタンの「テンプレートから…」
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { NewNoteSplitButton } from "./NewNoteSplitButton";
import { LocaleProvider, t } from "../i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => cleanup());

function open(props: Parameters<typeof NewNoteSplitButton>[0]) {
  const view = render(
    <LocaleProvider>
      <NewNoteSplitButton {...props} />
    </LocaleProvider>,
  );
  fireEvent.click(view.getByLabelText(t("sidebar.newMenu")));
  return view;
}

describe("NewNoteSplitButton: テンプレートから…", () => {
  it("▾ に並び、押すと onNewNoteFromTemplate が呼ばれる", () => {
    const onTpl = vi.fn();
    const view = open({ onNewNote: () => {}, onNewNoteFromTemplate: onTpl });
    fireEvent.click(view.getByText(t("sidebar.newNoteFromTemplate")));
    expect(onTpl).toHaveBeenCalledTimes(1);
  });

  it("音声ノートが無くてもテンプレートだけで ▾ が出る", () => {
    const view = open({ onNewNote: () => {}, onNewNoteFromTemplate: () => {} });
    expect(view.queryByText(t("sidebar.newVoiceNote"))).toBeNull();
    expect(view.getByText(t("sidebar.newNoteFromTemplate"))).toBeTruthy();
  });
});
