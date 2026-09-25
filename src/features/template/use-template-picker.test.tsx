// @vitest-environment jsdom
// スラッシュメニューの「テンプレート」とピッカー（useTemplatePicker）のテスト
//
// メインエディタと SidePeek は同じ項目・同じフックを使う。項目は押されたエディタを
// キーに受け口を引くので、ピークで押したテンプレートはピークのエディタに挿さり、
// ラベル・リンク・表の設定はピークのノートのストアにだけ書かれる。以前は受け口が
// モジュール変数 1 つ（メインに固定）で、ピークに出すとメイン側のノートに書き込んでいた。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, act, within } from "@testing-library/react";

const loader = vi.hoisted(() => ({ loadSharedTemplate: vi.fn() }));
vi.mock("./insert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./insert")>()),
  loadSharedTemplate: loader.loadSharedTemplate,
}));

import { LocaleProvider, t } from "../../i18n";
import type { SharedEntry } from "../../lib/storage/shared";
import {
  __setSharedLibraryLoaderForTest,
  groupSharedEntriesByType,
} from "../sharing/shared-library-store";
import type { TemplateTargetStores } from "./insert";
import { getTemplateSlashMenuItem } from "./slash-menu-item";
import type { PageTemplate } from "./types";
import { useTemplatePicker } from "./use-template-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** useTemplatePicker が使う範囲だけを持つエディタの偽物（中身は 1 段のブロック列） */
function makeEditor() {
  let doc: any[] = [{ id: "slash", type: "paragraph", content: [{ type: "text", text: "/", styles: {} }], children: [] }];
  const editor = {
    domElement: { isConnected: true },
    get document() {
      return doc;
    },
    getTextCursorPosition: () => ({ block: doc[0] }),
    insertBlocks(blocks: any[], ref: any) {
      const copies = structuredClone(blocks);
      const at = doc.findIndex((b) => b.id === ref.id);
      doc.splice(at + 1, 0, ...copies);
      return copies;
    },
    removeBlocks(blocks: any[]) {
      const ids = new Set(blocks.map((b) => b.id));
      doc = doc.filter((b) => !ids.has(b.id));
    },
    getBlock: (id: string) => doc.find((b) => b.id === id) ?? null,
    setTextCursorPosition: () => {},
  };
  return editor;
}

/** 書き込みを記録するストア（呼ばれた順に種類だけ残す） */
function recordingStores() {
  const calls: string[] = [];
  const stores: TemplateTargetStores = {
    setLabel: () => void calls.push("label"),
    setAttributes: () => void calls.push("attributes"),
    addLink: () => void calls.push("link"),
    addColumnType: (_blockId, _columnName, type) => void calls.push(`column:${type}`),
  };
  return { stores, calls };
}

function Host({ name, editor, stores }: { name: string; editor: any; stores: TemplateTargetStores }) {
  const picker = useTemplatePicker(editor, { stores });
  return (
    <div data-testid={name} data-open={String(picker.open)}>
      {picker.dialog}
    </div>
  );
}

/** メインとピークを同時に描く（画面に 2 つのエディタが同居する状態） */
function renderBoth() {
  const main = { editor: makeEditor(), ...recordingStores() };
  const peek = { editor: makeEditor(), ...recordingStores() };
  const view = render(
    <LocaleProvider>
      <Host name="main" editor={main.editor} stores={main.stores} />
      <Host name="peek" editor={peek.editor} stores={peek.stores} />
    </LocaleProvider>,
  );
  const host = (name: "main" | "peek") => view.getByTestId(name);
  return { main, peek, host, view };
}

/** スラッシュメニューで「テンプレート」を選んだときと同じ呼び出し */
function pressTemplateItem(editor: unknown) {
  act(() => {
    getTemplateSlashMenuItem().onItemClick(editor);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  __setSharedLibraryLoaderForTest(null, { root: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  loader.loadSharedTemplate.mockReset();
  __setSharedLibraryLoaderForTest(null, { root: null });
});

describe("スラッシュメニューの「テンプレート」", () => {
  it("押したエディタのピッカーだけが開く（どちらの向きでも）", () => {
    const { main, peek, host } = renderBoth();

    pressTemplateItem(peek.editor);
    expect(host("peek").dataset.open).toBe("true");
    expect(host("main").dataset.open).toBe("false");
    expect(within(host("main")).queryAllByTestId("official-template-row")).toHaveLength(0);

    // Escape で閉じてから、今度はメインで押す（受け口が 1 つだと後から登録した側が開く）
    fireEvent.keyDown(window, { key: "Escape" });
    expect(host("peek").dataset.open).toBe("false");
    pressTemplateItem(main.editor);
    expect(host("main").dataset.open).toBe("true");
    expect(host("peek").dataset.open).toBe("false");
  });

  it("ピークで選んだ公式テンプレートはピークに挿さり、表の設定もピークのストアにだけ書かれる", () => {
    const { main, peek, host } = renderBoth();

    pressTemplateItem(peek.editor);
    const planRow = within(host("peek"))
      .getAllByTestId("official-template-row")
      .find((row) => row.textContent?.includes(t("template.plan.title")));
    expect(planRow).toBeDefined();
    fireEvent.click(planRow!);
    act(() => {
      vi.runAllTimers();
    });

    // 挿入先はピークのエディタ。スラッシュだけのブロックは消える
    expect(peek.editor.document.some((b) => b.type === "table")).toBe(true);
    expect(peek.editor.getBlock("slash")).toBeNull();
    // 計画テンプレートの表はインデックステーブルになる（note-link）
    expect(peek.calls).toContain("column:note-link");
    // メイン側のノートには何も入らない
    expect(main.editor.document.map((b) => b.id)).toEqual(["slash"]);
    expect(main.calls).toEqual([]);
    // 選んだらピッカーは閉じる
    expect(host("peek").dataset.open).toBe("false");
  });

  it("閉じた（アンマウントした）エディタの受け口は外れ、押しても何も起きない", () => {
    const { peek, view } = renderBoth();
    view.unmount();

    expect(() => pressTemplateItem(peek.editor)).not.toThrow();
    expect(peek.editor.document.map((b) => b.id)).toEqual(["slash"]);
  });
});

describe("チームの共有テンプレート", () => {
  const ROOT = "/tmp/shared-root";
  const ENTRY = {
    id: "tpl-1",
    type: "template",
    author: { name: "Ada", email: "ada@example.com" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    hash: "sha256:tpl-1",
    prov: { derived_from: [] },
    version: 1,
    extra: { title: "焼結テンプレ" },
  } as unknown as SharedEntry;
  const TEMPLATE: PageTemplate = {
    name: "焼結テンプレ",
    savedAt: "2026-09-01T00:00:00Z",
    pageTitle: "焼結の手順",
    blocks: [{ id: "p1", type: "paragraph", content: [{ type: "text", text: "焼結する", styles: {} }], children: [] }],
    labels: [["p1", "free"]],
    attributes: [],
  };

  /** 共有ルートにテンプレートが 1 件ある状態でピークのピッカーを開き、チーム行を押す */
  async function pickTeamTemplateInPeek(beforeLoaded?: (peek: ReturnType<typeof renderBoth>["peek"]) => void) {
    __setSharedLibraryLoaderForTest(
      vi.fn(async () => ({ entries: groupSharedEntriesByType([ENTRY]), errors: {} })),
      { root: ROOT },
    );
    let resolveLoad: (value: PageTemplate) => void = () => {};
    loader.loadSharedTemplate.mockReturnValue(new Promise<PageTemplate>((resolve) => (resolveLoad = resolve)));

    const both = renderBoth();
    pressTemplateItem(both.peek.editor);
    // ピッカーが開いた時点の共有ライブラリ読み直し（非同期）を流し切る
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(within(both.host("peek")).getByTestId("team-template-row"));
    beforeLoaded?.(both.peek);
    await act(async () => {
      resolveLoad(TEMPLATE);
      await Promise.resolve();
    });
    act(() => {
      vi.runAllTimers();
    });
    return both;
  }

  it("ピークで選んだ共有テンプレートはピークに挿さり、ラベルもピークのストアにだけ書かれる", async () => {
    const { main, peek } = await pickTeamTemplateInPeek();

    expect(loader.loadSharedTemplate).toHaveBeenCalledWith(ENTRY, undefined);
    expect(peek.editor.document.some((b) => b.content?.[0]?.text === "焼結する")).toBe(true);
    expect(peek.calls).toEqual(["label"]);
    expect(main.editor.document.map((b) => b.id)).toEqual(["slash"]);
    expect(main.calls).toEqual([]);
  });

  it("読み出しを待つ間にピークを閉じたら挿さない（注釈も書かない）", async () => {
    const { peek } = await pickTeamTemplateInPeek((p) => {
      p.editor.domElement.isConnected = false;
    });

    expect(peek.editor.document.map((b) => b.id)).toEqual(["slash"]);
    expect(peek.calls).toEqual([]);
  });
});
