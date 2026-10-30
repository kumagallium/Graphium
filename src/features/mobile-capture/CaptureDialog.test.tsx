// @vitest-environment jsdom
// CaptureDialog の付け先チップのテスト。
//
// 対象の不変条件:
// - target が無い／none ならチップを出さず、onSubmit の第 3 引数は渡らない（target 無し）か none
// - block / note / asset のとき、種類ごとの抜粋・題・名前をチップに出す
// - ✕ で外すと、チップが消え、onSubmit には none が渡る（外さなければそのままの付け先）
// - targetRemovable=false のとき ✕ を出さず、付け先は外れない
// 文言は LocaleProvider の既定（jsdom → en）で照合する。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { CaptureDialog } from "./CaptureDialog";
import type { MemoTarget } from "./memo-target";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

function setup(props: Partial<React.ComponentProps<typeof CaptureDialog>> = {}) {
  const onSubmit = vi.fn(async () => {});
  render(
    <LocaleProvider>
      <CaptureDialog
        variant="centered"
        submitting={false}
        onSubmit={onSubmit}
        onClose={() => {}}
        {...props}
      />
    </LocaleProvider>,
  );
  return { onSubmit };
}

async function writeAndSubmit(text: string) {
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
}

const BLOCK: MemoTarget = {
  kind: "block",
  fileId: "n1",
  title: "SEM 観察",
  blockId: "b1",
  blockText: "粒界に析出物",
};

describe("CaptureDialog の付け先チップ", () => {
  it("target を渡さなければチップを出さず、第 3 引数も渡さない", async () => {
    const { onSubmit } = setup();
    expect(document.querySelector('[data-test="memoTargetChip"]')).toBeNull();
    await writeAndSubmit("メモ");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith("メモ", undefined, undefined);
  });

  it("none ならチップを出さない", () => {
    setup({ target: { kind: "none" } });
    expect(document.querySelector('[data-test="memoTargetChip"]')).toBeNull();
  });

  it("block は抜粋を、note は題を、asset は名前を出す", () => {
    const { unmount } = render(
      <LocaleProvider>
        <CaptureDialog variant="centered" submitting={false} onSubmit={async () => {}} onClose={() => {}} target={BLOCK} />
      </LocaleProvider>,
    );
    expect(screen.getByTitle("粒界に析出物")).toBeTruthy();
    unmount();

    const n = render(
      <LocaleProvider>
        <CaptureDialog
          variant="centered"
          submitting={false}
          onSubmit={async () => {}}
          onClose={() => {}}
          target={{ kind: "note", fileId: "n1", title: "SEM 観察" }}
        />
      </LocaleProvider>,
    );
    expect(screen.getByTitle("SEM 観察")).toBeTruthy();
    n.unmount();

    render(
      <LocaleProvider>
        <CaptureDialog
          variant="centered"
          submitting={false}
          onSubmit={async () => {}}
          onClose={() => {}}
          target={{ kind: "asset", fileId: "i1", type: "image", name: "sem.png" }}
        />
      </LocaleProvider>,
    );
    expect(screen.getByTitle("sem.png")).toBeTruthy();
  });

  it("題の無い note は「This note」、抜粋の無い block は汎用の文言を出す", () => {
    const { unmount } = render(
      <LocaleProvider>
        <CaptureDialog
          variant="centered"
          submitting={false}
          onSubmit={async () => {}}
          onClose={() => {}}
          target={{ kind: "note", fileId: "n1" }}
        />
      </LocaleProvider>,
    );
    expect(screen.getByTitle("This note")).toBeTruthy();
    unmount();
    render(
      <LocaleProvider>
        <CaptureDialog
          variant="centered"
          submitting={false}
          onSubmit={async () => {}}
          onClose={() => {}}
          target={{ kind: "block", fileId: "n1", blockId: "b1", blockText: "" }}
        />
      </LocaleProvider>,
    );
    expect(screen.getByTitle("Linked block")).toBeTruthy();
  });

  it("外さなければ、付け先をそのまま onSubmit に渡す", async () => {
    const { onSubmit } = setup({ target: BLOCK });
    await writeAndSubmit("メモ");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith("メモ", undefined, BLOCK);
  });

  it("✕ で外すとチップが消え、none が渡る", async () => {
    const { onSubmit } = setup({ target: BLOCK });
    fireEvent.click(screen.getByRole("button", { name: "Detach" }));
    expect(screen.queryByTitle("粒界に析出物")).toBeNull();
    await writeAndSubmit("メモ");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith("メモ", undefined, { kind: "none" });
  });

  it("targetRemovable=false のときは ✕ を出さず、付け先は外れない", async () => {
    const { onSubmit } = setup({ target: BLOCK, targetRemovable: false });
    expect(screen.queryByRole("button", { name: "Detach" })).toBeNull();
    await writeAndSubmit("メモ");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith("メモ", undefined, BLOCK);
  });
});
