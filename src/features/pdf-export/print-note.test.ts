// @vitest-environment jsdom
// 印刷ルートの組み立てのテスト
//
// 画面 DOM から紙面用のツリーを作る部分だけを対象にする（レイアウト実測を伴う
// fitContentToPage と、印刷ダイアログを開く printNote 全体は jsdom では意味を
// 持たないので、実ブラウザでの確認に任せる）。
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { cloneEditorContent, buildHeader, printAndWait } from "./print-note";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function makeEditor(html: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "bn-editor";
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("cloneEditorContent", () => {
  it("エディタの操作 UI を落とす", () => {
    const editor = makeEditor(`
      <div class="bn-block"><p>本文</p></div>
      <div data-side-menu="true">side</div>
      <div class="bnDragHandle">handle</div>
      <div data-chart-ui="true">chart settings</div>
    `);
    const clone = cloneEditorContent(editor);
    expect(clone.querySelector("[data-side-menu]")).toBeNull();
    expect(clone.querySelector('[class*="DragHandle"]')).toBeNull();
    expect(clone.querySelector("[data-chart-ui]")).toBeNull();
    // 本文は残る
    expect(clone.textContent).toContain("本文");
  });

  it("計算ブロックの textarea を行ごとの div に置き換え、入力値を保つ", () => {
    // cloneNode は textarea の value を引き継がないので、元の DOM から拾えているかを見る
    const editor = makeEditor(`
      <div data-test="calc-block">
        <textarea data-calc-source></textarea>
        <div data-calc-results><div>5 g</div></div>
      </div>
    `);
    const area = editor.querySelector("textarea")!;
    area.value = "m = 5 g\nh = 1 cm";

    const clone = cloneEditorContent(editor);
    expect(clone.querySelector("textarea")).toBeNull();
    const source = clone.querySelector("[data-calc-source]")!;
    expect(source.tagName).toBe("DIV");
    expect([...source.children].map((c) => c.textContent)).toEqual(["m = 5 g", "h = 1 cm"]);
    // 結果列は元のまま残る（行の対応が崩れない）
    expect(clone.querySelector("[data-calc-results]")?.textContent).toBe("5 g");
  });

  it("計算ブロックが複数あってもそれぞれの入力値が対応する", () => {
    const editor = makeEditor(`
      <div data-test="calc-block"><textarea></textarea></div>
      <div data-test="calc-block"><textarea></textarea></div>
    `);
    const areas = editor.querySelectorAll("textarea");
    areas[0].value = "first";
    areas[1].value = "second";

    const sources = cloneEditorContent(editor).querySelectorAll("[data-calc-source]");
    expect(sources[0].textContent).toBe("first");
    expect(sources[1].textContent).toBe("second");
  });

  it("空行も 1 行として保つ（結果列と行がずれない）", () => {
    const editor = makeEditor(`<div data-test="calc-block"><textarea></textarea></div>`);
    editor.querySelector("textarea")!.value = "a = 1\n\nb = 2";
    const source = cloneEditorContent(editor).querySelector("[data-calc-source]")!;
    expect(source.children.length).toBe(3);
  });
});

describe("buildHeader", () => {
  it("タイトルと日時を出す", () => {
    const host = document.createElement("div");
    host.appendChild(buildHeader("実験ノート"));
    expect(host.querySelector(".graphium-print-title")?.textContent).toBe("実験ノート");
    expect(host.querySelector(".graphium-print-date")?.textContent).toBeTruthy();
  });

  it("ラベルは重複を除いて並べる", () => {
    const host = document.createElement("div");
    const labels = new Map([
      ["b1", "焼成"],
      ["b2", "秤量"],
      ["b3", "焼成"],
    ]);
    host.appendChild(buildHeader("t", labels));
    const badges = [...host.querySelectorAll(".graphium-print-labels span")].map((s) => s.textContent);
    expect(badges).toEqual(["焼成", "秤量"].sort());
  });

  it("ラベルが無いときはラベル欄を作らない", () => {
    const host = document.createElement("div");
    host.appendChild(buildHeader("t", new Map()));
    expect(host.querySelector(".graphium-print-labels")).toBeNull();
  });
});

describe("printAndWait", () => {
  it("印刷ダイアログが閉じたら解決する", async () => {
    const print = vi.fn(() => {
      // ダイアログが閉じられた体で afterprint を流す
      setTimeout(() => window.dispatchEvent(new Event("afterprint")), 0);
    });
    vi.stubGlobal("print", print);
    await printAndWait();
    expect(print).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("afterprint が来ない環境でも取り残されない", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("print", vi.fn());
    const pending = printAndWait();
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(pending).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });

  // macOS の WKWebView は window.print() を握り潰すので、デスクトップでは
  // Rust 側にパネルを開かせる。パネルを閉じた合図は返ってこないため、
  // ここで待たずに解決すること（待つと「準備中」が保険のタイマーまで残る）。
  it("デスクトップでは Rust 側の印刷パネルを開き、待たずに解決する", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    (window as unknown as Record<string, unknown>).__TAURI__ = {};
    try {
      await expect(printAndWait()).resolves.toBeUndefined();
      expect(invoke).toHaveBeenCalledWith("print_webview");
      expect(print).not.toHaveBeenCalled();
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI__;
      vi.unstubAllGlobals();
      vi.mocked(invoke).mockClear();
    }
  });
});
