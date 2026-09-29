// @vitest-environment jsdom
// 表キャプション層の要素の見張り（E-4 / B-5）。
//
// 不変条件:
// - <style>（上余白 marginCss）の中身が書き換わったら通知する。React は <style> の
//   文字列を既存の text node の書き換えで更新するので、childList では拾えない。
// - 本文（<style> 以外）の text node の書き換えでは通知しない。wrapper 全体に
//   characterData を掛けると入力のたびに重い計算が走る。
// - 名前の行は ResizeObserver に登録し、DOM から外れたら外す。

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  watchCaptionTargets,
  CAPTION_ROW_ATTR,
  CAPTION_STYLE_ATTR,
} from "./caption-watch";

/** MutationObserver のコールバックは microtask で呼ばれるので 1 回待つ */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function makeRo() {
  return {
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as ResizeObserver & {
    observe: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>;
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

function mountWrapper() {
  const wrapper = document.createElement("div");
  const body = document.createElement("p");
  body.textContent = "本文";
  wrapper.appendChild(body);
  const style = document.createElement("style");
  style.setAttribute(CAPTION_STYLE_ATTR, "");
  style.textContent = "";
  wrapper.appendChild(style);
  const row = document.createElement("div");
  row.setAttribute(CAPTION_ROW_ATTR, "t1");
  wrapper.appendChild(row);
  document.body.appendChild(wrapper);
  return { wrapper, body, style, row };
}

describe("watchCaptionTargets", () => {
  it("<style> の中身の書き換え（空 → 埋まる）を通知する", async () => {
    const { wrapper, style } = mountWrapper();
    const onStyleChange = vi.fn();
    const watch = watchCaptionTargets(wrapper, makeRo(), onStyleChange);
    watch.sync();

    // React の更新は既存の text node のデータ書き換え
    style.textContent = "x"; // text node を作る
    await flush();
    onStyleChange.mockClear();
    (style.firstChild as Text).data = "[data-id=t1]{margin-top:26px;}";
    await flush();
    expect(onStyleChange).toHaveBeenCalled();
    watch.disconnect();
  });

  it("本文の text node の書き換えでは通知しない", async () => {
    const { wrapper, body } = mountWrapper();
    const onStyleChange = vi.fn();
    const watch = watchCaptionTargets(wrapper, makeRo(), onStyleChange);
    watch.sync();
    (body.firstChild as Text).data = "本文を打った";
    await flush();
    expect(onStyleChange).not.toHaveBeenCalled();
    watch.disconnect();
  });

  it("名前の行を ResizeObserver に登録し、外れたら unobserve する", () => {
    const { wrapper, row } = mountWrapper();
    const ro = makeRo();
    const watch = watchCaptionTargets(wrapper, ro, () => {});
    watch.sync();
    watch.sync(); // 二度目は重複登録しない
    expect(ro.observe).toHaveBeenCalledTimes(1);
    expect(ro.observe).toHaveBeenCalledWith(row);

    row.remove();
    watch.sync();
    expect(ro.unobserve).toHaveBeenCalledWith(row);
    watch.disconnect();
  });

  it("後から現れた <style> も sync で見張りに加わる", async () => {
    const wrapper = document.createElement("div");
    document.body.appendChild(wrapper);
    const onStyleChange = vi.fn();
    const watch = watchCaptionTargets(wrapper, makeRo(), onStyleChange);
    watch.sync();

    const style = document.createElement("style");
    style.setAttribute(CAPTION_STYLE_ATTR, "");
    style.textContent = "a";
    wrapper.appendChild(style);
    watch.sync();
    await flush();
    onStyleChange.mockClear();
    (style.firstChild as Text).data = "b";
    await flush();
    expect(onStyleChange).toHaveBeenCalled();
    watch.disconnect();
  });
});
