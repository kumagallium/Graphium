// @vitest-environment jsdom
// useGlobalFileDrop のテスト
//
// jsdom には DragEvent が無いため、bubbles:true の Event を作って
// dataTransfer を Object.defineProperty で後付けする。target は
// dispatchEvent を呼ぶ要素（bubble して window まで届く）で決める。

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useGlobalFileDrop } from "./use-global-file-drop";
import * as collectModule from "./collect-dropped-files";
import type { IntakeFile } from "./types";
import { intakeFileFrom } from "./test-helpers";

function makeFileDragEvent(type: string): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", {
    value: { types: ["Files"], files: [], items: [] },
    configurable: true,
  });
  return e;
}

function dispatchFrom(target: EventTarget, type: string): Event {
  const e = makeFileDragEvent(type);
  target.dispatchEvent(e);
  return e;
}

afterEach(() => {
  // 前のテストのフックが window に残ると、その preventDefault で後のテストの drop が「受け取り済み」に見える
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("useGlobalFileDrop", () => {
  it("enter で dragActive が true になり、leave で false に戻る", () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useGlobalFileDrop({ enabled: true, onFiles }));

    act(() => {
      dispatchFrom(window, "dragenter");
    });
    expect(result.current.dragActive).toBe(true);

    act(() => {
      dispatchFrom(window, "dragleave");
    });
    expect(result.current.dragActive).toBe(false);
  });

  it("[data-intake-drop] を持つ要素からの enter はカウントしない", () => {
    const onFiles = vi.fn();
    const dropZone = document.createElement("div");
    dropZone.setAttribute("data-intake-drop", "");
    document.body.appendChild(dropZone);

    const { result } = renderHook(() => useGlobalFileDrop({ enabled: true, onFiles }));

    act(() => {
      dispatchFrom(dropZone, "dragenter");
    });
    expect(result.current.dragActive).toBe(false);
  });

  it("suspended のときは dragActive にならず onFiles も呼ばれないが、既定動作は止める", async () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useGlobalFileDrop({ enabled: true, onFiles, suspended: true }));

    let enterEvent: Event;
    act(() => {
      enterEvent = dispatchFrom(window, "dragenter");
    });
    expect(result.current.dragActive).toBe(false);
    expect(enterEvent!.defaultPrevented).toBe(true);

    let dropEvent: Event;
    await act(async () => {
      dropEvent = dispatchFrom(window, "drop");
    });
    expect(onFiles).not.toHaveBeenCalled();
    expect(dropEvent!.defaultPrevented).toBe(true);
  });

  it("drop で onFiles が呼ばれ、collectDroppedFiles のフォールバック経由で files が渡る", async () => {
    const droppedFile = new File(["x"], "note.md");
    const fakeFiles: IntakeFile[] = [intakeFileFrom(droppedFile, "note.md")];
    vi.spyOn(collectModule, "collectDroppedFiles").mockResolvedValue(fakeFiles);

    const onFiles = vi.fn();
    renderHook(() => useGlobalFileDrop({ enabled: true, onFiles }));

    await act(async () => {
      dispatchFrom(window, "drop");
      // collectDroppedFiles は Promise 経由なので 1 tick 待つ
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onFiles).toHaveBeenCalledWith(fakeFiles);
  });

  it("エディタが受け取ったドロップ（defaultPrevented）は拾わない — 落とし先がドキュメントから外れていても", async () => {
    const collect = vi.spyOn(collectModule, "collectDroppedFiles").mockResolvedValue([]);
    const onFiles = vi.fn();
    renderHook(() => useGlobalFileDrop({ enabled: true, onFiles }));

    // 空の段落へ画像を落としたときの再現: エディタ（BlockNote）が drop を受け取って
    // preventDefault し、落とし先の段落を画像ブロックに置き換える（段落の要素は外れる）
    const editor = document.createElement("div");
    editor.className = "bn-editor";
    const paragraph = document.createElement("div");
    paragraph.className = "bn-inline-content";
    editor.appendChild(paragraph);
    document.body.appendChild(editor);
    editor.addEventListener("drop", (e) => {
      e.preventDefault();
      paragraph.remove();
    });

    await act(async () => {
      dispatchFrom(paragraph, "drop");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(collect).not.toHaveBeenCalled();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("誰も受け取らなかったドロップは、これまでどおり拾う", async () => {
    vi.spyOn(collectModule, "collectDroppedFiles").mockResolvedValue([]);
    const onFiles = vi.fn();
    renderHook(() => useGlobalFileDrop({ enabled: true, onFiles }));

    const pane = document.createElement("div");
    document.body.appendChild(pane);
    let e!: Event;
    await act(async () => {
      e = dispatchFrom(pane, "drop");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });
});
