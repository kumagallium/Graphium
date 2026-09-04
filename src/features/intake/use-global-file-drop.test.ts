// @vitest-environment jsdom
// useGlobalFileDrop のテスト
//
// jsdom には DragEvent が無いため、bubbles:true の Event を作って
// dataTransfer を Object.defineProperty で後付けする。target は
// dispatchEvent を呼ぶ要素（bubble して window まで届く）で決める。

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGlobalFileDrop } from "./use-global-file-drop";
import * as collectModule from "./collect-dropped-files";
import type { IntakeFile } from "./types";

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
    const fakeFiles: IntakeFile[] = [{ file: droppedFile, path: "note.md" }];
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
});
