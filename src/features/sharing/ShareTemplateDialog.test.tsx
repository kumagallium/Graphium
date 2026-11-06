// @vitest-environment jsdom
// テンプレートの共有で共有先を複数選ぶ（テンプレートだけ。選んだ数だけ別々のテンプレートを置く）。
// - 共有フォルダが 2 件以上ならチェックボックスで選べ、最初は既定の共有先だけに印
// - 2 か所を選ぶと 2 回置き、onShared に 2 件渡る
// - 1 か所が失敗しても残りは置き、置けた方は選択から外して理由を出す（やり直しで二重に置かない）

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { createSharedFolder, setSharedFolders, type SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const shareTemplate = vi.fn();
vi.mock("./share-template", () => ({ shareTemplate: (...a: unknown[]) => shareTemplate(...a) }));
vi.mock("../identity", () => ({ loadAuthorIdentity: () => ({ name: "Ken", email: "ken@example.org" }) }));

import { ShareTemplateDialog } from "./ShareTemplateDialog";

const ORG = "/Volumes/Org";
const TEAM = "/Volumes/TeamA";
const page = { id: "p1", title: "Feeding log", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] } as never;
const resolveSource = async () => ({ doc: { pages: [page] } as never, page });

beforeEach(() => {
  localStorage.clear();
  shareTemplate.mockReset();
  setSharedFolders([createSharedFolder(ORG, "Whole org"), createSharedFolder(TEAM, "Team A")]);
});
afterEach(() => cleanup());

function renderDialog(onShared = vi.fn(), onClose = vi.fn()) {
  render(
    <LocaleProvider>
      <ShareTemplateDialog open defaultTitle="Feeding log" resolveSource={resolveSource} onClose={onClose} onShared={onShared} />
    </LocaleProvider>,
  );
  return { onShared, onClose };
}

describe("ShareTemplateDialog の共有先（複数）", () => {
  it("最初は既定の共有先だけに印", () => {
    renderDialog();
    expect((screen.getByRole("checkbox", { name: /Whole org/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Team A/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("2 か所を選ぶと 2 回置き、2 件を知らせて閉じる", async () => {
    shareTemplate.mockImplementation(async (_d, _p, o: { sharedRoot: string }) => ({ ok: true, entry: { id: o.sharedRoot } as SharedEntry }));
    const { onShared, onClose } = renderDialog();
    fireEvent.click(screen.getByRole("checkbox", { name: /Team A/ }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(shareTemplate.mock.calls.map((c) => (c[2] as { sharedRoot: string }).sharedRoot)).toEqual([ORG, TEAM]);
    expect(onShared).toHaveBeenCalledWith([{ id: ORG }, { id: TEAM }]);
  });

  it("1 か所が失敗しても残りは置き、置けた方は選択から外して閉じない", async () => {
    shareTemplate.mockImplementation(async (_d, _p, o: { sharedRoot: string }) =>
      o.sharedRoot === TEAM ? { ok: false, error: "not reachable" } : { ok: true, entry: { id: ORG } as SharedEntry },
    );
    const { onShared, onClose } = renderDialog();
    fireEvent.click(screen.getByRole("checkbox", { name: /Team A/ }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await screen.findByText(/Team A: not reachable/);
    expect(onClose).not.toHaveBeenCalled();
    expect(onShared).toHaveBeenCalledWith([{ id: ORG }]);
    expect((screen.getByRole("checkbox", { name: /Whole org/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: /Team A/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("どこも選ばれていなければ共有ボタンを押せない", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("checkbox", { name: /Whole org/ }));
    expect((screen.getByRole("button", { name: "Share" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
