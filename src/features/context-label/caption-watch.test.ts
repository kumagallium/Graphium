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

  it("後から現れた <style> も、呼び出し側が sync しなくても見張りに加わる（E-4）", async () => {
    // ノートをサイドピークで直接開いた直後は、見張りを張った時点で <style> がまだ無い。
    // 呼び出し側は最初の 1 回しか sync しないので、watch が自分で購読しなければならない
    const wrapper = document.createElement("div");
    document.body.appendChild(wrapper);
    const onStyleChange = vi.fn();
    const watch = watchCaptionTargets(wrapper, makeRo(), onStyleChange);
    watch.sync(); // この時点では <style> が無い

    const style = document.createElement("style");
    style.setAttribute(CAPTION_STYLE_ATTR, "");
    style.textContent = "a";
    wrapper.appendChild(style);
    await flush();
    // 出現そのものが、上余白の反映として通知される
    expect(onStyleChange).toHaveBeenCalled();

    onStyleChange.mockClear();
    (style.firstChild as Text).data = "b"; // 出現後の書き換えも拾う
    await flush();
    expect(onStyleChange).toHaveBeenCalled();
    watch.disconnect();
  });

  it("<style> が差し替わっても（React が作り直した場合）、新しい <style> の書き換えを拾う", async () => {
    const { wrapper, style } = mountWrapper();
    const onStyleChange = vi.fn();
    const watch = watchCaptionTargets(wrapper, makeRo(), onStyleChange);
    watch.sync();

    style.remove();
    const next = document.createElement("style");
    next.setAttribute(CAPTION_STYLE_ATTR, "");
    next.textContent = "x";
    wrapper.appendChild(next);
    await flush();
    expect(onStyleChange).toHaveBeenCalled();

    onStyleChange.mockClear();
    (next.firstChild as Text).data = "y";
    await flush();
    expect(onStyleChange).toHaveBeenCalled();
    watch.disconnect();
  });

  it("<style> と無関係な本文の追加・削除では通知しない", async () => {
    const { wrapper } = mountWrapper();
    const onStyleChange = vi.fn();
    const watch = watchCaptionTargets(wrapper, makeRo(), onStyleChange);
    watch.sync();
    await flush();
    onStyleChange.mockClear();
    const p = document.createElement("p");
    p.textContent = "新しい段落";
    wrapper.appendChild(p);
    await flush();
    p.remove();
    await flush();
    expect(onStyleChange).not.toHaveBeenCalled();
    watch.disconnect();
  });

  it("後から現れた名前の行も、sync しなくても ResizeObserver に加わる", async () => {
    const wrapper = document.createElement("div");
    document.body.appendChild(wrapper);
    const ro = makeRo();
    const watch = watchCaptionTargets(wrapper, ro, () => {});
    watch.sync();
    expect(ro.observe).not.toHaveBeenCalled();

    const row = document.createElement("div");
    row.setAttribute(CAPTION_ROW_ATTR, "t1");
    wrapper.appendChild(row);
    await flush();
    expect(ro.observe).toHaveBeenCalledWith(row);
    watch.disconnect();
  });

  it("エディタ本体と wrapper までの祖先の寸法も見張る（表が下がると本文の高さが変わる）", async () => {
    const wrapper = document.createElement("div");
    const pad = document.createElement("div");
    const editor = document.createElement("div");
    editor.className = "bn-editor";
    pad.appendChild(editor);
    wrapper.appendChild(pad);
    document.body.appendChild(wrapper);
    const ro = makeRo();
    const watch = watchCaptionTargets(wrapper, ro, () => {});
    watch.sync();
    expect(ro.observe).toHaveBeenCalledWith(editor);
    expect(ro.observe).toHaveBeenCalledWith(pad);
    // wrapper 自体は呼び出し側が見ているので、ここでは加えない
    expect(ro.observe).not.toHaveBeenCalledWith(wrapper);

    // エディタが作り直されたら、古い方を外して新しい方を見る
    const editor2 = document.createElement("div");
    editor2.className = "bn-editor";
    pad.replaceChild(editor2, editor);
    await flush();
    expect(ro.unobserve).toHaveBeenCalledWith(editor);
    expect(ro.observe).toHaveBeenCalledWith(editor2);
    watch.disconnect();
    expect(ro.unobserve).toHaveBeenCalledWith(editor2);
  });
});
