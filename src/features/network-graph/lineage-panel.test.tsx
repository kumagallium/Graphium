// @vitest-environment jsdom
// 来歴パネルの URL ソース行クリックの振り分けテスト
//
// 対象の不変条件:
// - URL ソースノード（kind: "url"）のクリックは、onOpenUrl が配線されていれば
//   アプリ内（素材サイドピークのリーダー）で開き、外部ブラウザには飛ばさない
// - onOpenUrl 未配線の文脈では従来どおり openExternalUrl（外部ブラウザ）に
//   フォールバックする（Storybook 等の未配線利用を壊さない）

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { LineagePanel } from "./lineage-panel";
import { LocaleProvider } from "../../i18n";
import type { LineageNode } from "./lineage-builder";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/external-link", () => ({
  openExternalUrl: vi.fn(),
}));
import { openExternalUrl } from "../../lib/external-link";

const URL = "https://en.wikipedia.org/wiki/Electronic_lab_notebook";

function makeTree(): LineageNode {
  const urlSource: LineageNode = {
    id: `url:${URL}`,
    title: "Electronic lab notebook",
    navId: null,
    isCurrent: false,
    kind: "url",
    depth: 1,
    relations: ["derived"] as unknown as LineageNode["relations"],
    parents: [],
    externalUrl: URL,
  };
  return {
    id: "note-1",
    title: "要約ノート",
    navId: "wiki:note-1",
    isCurrent: true,
    kind: "wiki",
    depth: 0,
    relations: [],
    parents: [urlSource],
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LineagePanel: URL ソース行のクリック振り分け", () => {
  it("onOpenUrl が配線されていればアプリ内で開き、外部ブラウザに飛ばさない", () => {
    const onOpenUrl = vi.fn();
    const { getByText } = render(
      <LocaleProvider>
        <LineagePanel
          tree={makeTree()}
          onNavigate={() => {}}
          onOpenUrl={onOpenUrl}
        />
      </LocaleProvider>,
    );
    fireEvent.click(getByText("Electronic lab notebook"));
    expect(onOpenUrl).toHaveBeenCalledWith(URL);
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("onOpenUrl 未配線なら従来どおり外部ブラウザにフォールバックする", () => {
    const { getByText } = render(
      <LocaleProvider>
        <LineagePanel tree={makeTree()} onNavigate={() => {}} />
      </LocaleProvider>,
    );
    fireEvent.click(getByText("Electronic lab notebook"));
    expect(openExternalUrl).toHaveBeenCalledWith(URL);
  });
});
