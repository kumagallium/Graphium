// @vitest-environment jsdom
// 書き出しダイアログの件数再計算とボタンの活性
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { AsterismExportDialog } from "./AsterismExportDialog";
import type { AsterismSettings } from "../settings/store";
import type { WikiMeta } from "../../lib/document-types";

const asterism = {
  vocabBaseIri: "https://example.org/vocab#",
  claimBaseIri: "",
  typeSlugs: { observation: "", interpretation: "", rule: "", judgment: "" },
} as AsterismSettings;

const claim = (extra: Partial<WikiMeta>) => ({ kind: "claim", ...extra }) as WikiMeta;

const items = [
  { id: "a", title: "A", meta: claim({ asterism: { typeSlug: "rule" } }) },
  { id: "b", title: "B", meta: claim({}) },
  { id: "c", title: "C", meta: claim({}) },
];

function setup(list = items, onExport = vi.fn()) {
  render(
    <LocaleProvider>
      <AsterismExportDialog items={list} asterism={asterism} defaultFileName="x.json" onExport={onExport} onCancel={() => {}} />
    </LocaleProvider>,
  );
  return onExport;
}

const inferredFrame = {
  decisionFrame: { triggerClaimIds: [], action: "a", rationale: null, rationaleBy: "inferred", reviewState: "inferred" },
} as unknown as Partial<WikiMeta>;

const withInferred = [
  { id: "a", title: "A", meta: claim({ asterism: { typeSlug: "rule" } }) },
  { id: "d", title: "D", meta: claim({ asterism: { typeSlug: "judgment" }, ...inferredFrame }) },
  { id: "b", title: "B", meta: claim({}) },
];

const exportButton = () => screen.getByRole("button", { name: "Export" }) as HTMLButtonElement;

afterEach(cleanup);

describe("AsterismExportDialog", () => {
  it("型なしを含めると対象件数が増え、除外件数が減る", () => {
    setup();
    const dlg = screen.getByRole("dialog");
    expect(dlg.textContent).toContain("1 claims will be exported");
    expect(dlg.textContent).toContain("Excluded: 2 untyped / 0 pending review");
    fireEvent.click(screen.getByRole("checkbox", { name: /Include untyped/ }));
    expect(dlg.textContent).toContain("3 claims will be exported");
    expect(dlg.textContent).toContain("Excluded: 0 untyped / 0 pending review");
  });
  it("確認待ちを含めると対象が増え、除外の確認待ちが減る", () => {
    setup(withInferred);
    const dlg = screen.getByRole("dialog");
    expect(dlg.textContent).toContain("1 claims will be exported");
    expect(dlg.textContent).toContain("1 pending review");
    fireEvent.click(screen.getByRole("checkbox", { name: /pending review/ }));
    expect(dlg.textContent).toContain("2 claims will be exported");
    expect(dlg.textContent).toContain("0 pending review");
  });
  it("対象 0 件では書き出せない", () => {
    setup([items[1]]);
    expect(exportButton().disabled).toBe(true);
  });
  it("ファイル名が空だと書き出せない", () => {
    setup();
    expect(exportButton().disabled).toBe(false);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  " } });
    expect(exportButton().disabled).toBe(true);
  });
  it("書き出すと選択とファイル名を渡す", () => {
    const onExport = setup();
    fireEvent.click(exportButton());
    expect(onExport).toHaveBeenCalledWith({ includeUntyped: false, includeInferred: false, fileName: "x.json" });
  });
  it("全件 inferred のときは確認待ちを含める案内を出す", () => {
    setup([withInferred[1]]);
    expect(screen.getByText(/All typed claims are pending review/)).toBeTruthy();
    expect(screen.queryByText(/Changing the type terms/)).toBeNull();
  });
  it("知見が無いときは型の案内を出さない", () => {
    setup([]);
    expect(screen.getByText("No claims can be exported.")).toBeTruthy();
    expect(screen.queryByText(/Changing the type terms/)).toBeNull();
  });
  it("IME 変換中の Esc では閉じない", () => {
    const onCancel = vi.fn();
    render(
      <LocaleProvider>
        <AsterismExportDialog items={items} asterism={asterism} defaultFileName="x.json" onExport={() => {}} onCancel={onCancel} />
      </LocaleProvider>,
    );
    fireEvent.keyDown(window, { key: "Escape", isComposing: true });
    fireEvent.keyDown(window, { key: "Escape", keyCode: 229 });
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
