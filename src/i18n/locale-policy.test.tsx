// @vitest-environment jsdom
//
// 公開前ロケール（ko）の扱いのテスト。
//
// 起動時の検出（保存値 → ブラウザの言語）はモジュール読み込み時に 1 回だけ走るので、
// 条件ごとにモジュールを読み直して確かめる（index.test.ts は en に戻してから使うため、
// 検出そのものは見ていない）。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, act, cleanup, screen } from "@testing-library/react";

const STORAGE_KEY = "graphium_locale";

type Setup = {
  /** localStorage に入っている言語（undefined なら無し） */
  saved?: string;
  /** navigator.language */
  browser?: string;
  /** VITE_ENABLE_PREVIEW_LOCALES=true にするか */
  preview?: boolean;
};

async function loadI18n({ saved, browser = "en-US", preview = false }: Setup) {
  vi.resetModules();
  localStorage.clear();
  if (saved !== undefined) localStorage.setItem(STORAGE_KEY, saved);
  vi.spyOn(navigator, "language", "get").mockReturnValue(browser);
  vi.stubEnv("VITE_ENABLE_PREVIEW_LOCALES", preview ? "true" : "");
  return await import("./index");
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("公開前ロケール（既定: 無効）", () => {
  it("ブラウザが ko-KR でも ko にならない", async () => {
    const i18n = await loadI18n({ browser: "ko-KR" });
    expect(i18n.getLocale()).toBe("en");
    expect(i18n.isLocaleEnabled("ko")).toBe(false);
    expect(i18n.getEnabledLocales()).toEqual(["en", "ja"]);
  });

  it("保存値 ko は en で表示し、保存値は消さない", async () => {
    const i18n = await loadI18n({ saved: "ko", browser: "ja-JP" });
    expect(i18n.getLocale()).toBe("en");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("ko");
  });

  it("syncLocale('ko') を直接呼んでも切り替わらない", async () => {
    const i18n = await loadI18n({ saved: "ja" });
    i18n.syncLocale("ko");
    expect(i18n.getLocale()).toBe("ja");
    expect(document.documentElement.lang).toBe("ja");
  });

  it("setLocale('ko') は無視され、保存値も変わらない", async () => {
    const i18n = await loadI18n({ saved: "ja" });
    let setLocale: (l: "en" | "ja" | "ko") => void = () => {};
    function Probe() {
      const ctx = i18n.useLocale();
      setLocale = ctx.setLocale;
      return <span data-testid="locale">{ctx.locale}</span>;
    }
    render(
      <i18n.LocaleProvider>
        <Probe />
      </i18n.LocaleProvider>,
    );
    act(() => setLocale("ko"));
    expect(screen.getByTestId("locale").textContent).toBe("ja");
    expect(i18n.getLocale()).toBe("ja");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("ja");
  });

  it("開発ビルドでなければ VITE_ENABLE_PREVIEW_LOCALES=true でも無効", async () => {
    vi.stubEnv("DEV", false);
    vi.resetModules();
    vi.spyOn(navigator, "language", "get").mockReturnValue("ko-KR");
    vi.stubEnv("VITE_ENABLE_PREVIEW_LOCALES", "true");
    const i18n = await import("./index");
    expect(i18n.isLocaleEnabled("ko")).toBe(false);
    expect(i18n.getLocale()).toBe("en");
  });
});

describe("ロケールの検出と保存値の復元", () => {
  it("保存値がブラウザの言語より優先される", async () => {
    const i18n = await loadI18n({ saved: "en", browser: "ja-JP" });
    expect(i18n.getLocale()).toBe("en");
  });

  it("ブラウザの言語（地域付き）から検出する", async () => {
    const i18n = await loadI18n({ browser: "ja-JP" });
    expect(i18n.getLocale()).toBe("ja");
  });

  it("壊れた保存値は無視してブラウザの言語に従う", async () => {
    const i18n = await loadI18n({ saved: "xx", browser: "ja-JP" });
    expect(i18n.getLocale()).toBe("ja");
  });

  it("起動時に <html lang> を合わせる", async () => {
    await loadI18n({ saved: "ja" });
    expect(document.documentElement.lang).toBe("ja");
  });
});

describe("公開前ロケール（開発時に試験有効化）", () => {
  it("ブラウザが ko-KR なら ko になる", async () => {
    const i18n = await loadI18n({ browser: "ko-KR", preview: true });
    expect(i18n.getLocale()).toBe("ko");
    expect(i18n.getEnabledLocales()).toEqual(["en", "ja", "ko"]);
    expect(document.documentElement.lang).toBe("ko");
  });

  it("保存値 ko を復元する（再起動しても保たれる）", async () => {
    const i18n = await loadI18n({ saved: "ko", browser: "ja-JP", preview: true });
    expect(i18n.getLocale()).toBe("ko");
  });

  it("en → ko → ja の切替が Context の内外と <html lang> に反映され、保存される", async () => {
    const i18n = await loadI18n({ saved: "en", preview: true });
    let setLocale: (l: "en" | "ja" | "ko") => void = () => {};
    function InContext() {
      const ctx = i18n.useLocale();
      setLocale = ctx.setLocale;
      return <span data-testid="in">{ctx.t("common.save")}</span>;
    }
    function OutOfContext() {
      i18n.useLocaleSubscription();
      return <span data-testid="out">{i18n.t("common.save")}</span>;
    }
    render(
      <>
        <i18n.LocaleProvider>
          <InContext />
        </i18n.LocaleProvider>
        <OutOfContext />
      </>,
    );
    expect(screen.getByTestId("in").textContent).toBe("Save");

    act(() => setLocale("ko"));
    expect(screen.getByTestId("in").textContent).toBe("저장");
    expect(screen.getByTestId("out").textContent).toBe("저장");
    expect(document.documentElement.lang).toBe("ko");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("ko");

    act(() => setLocale("ja"));
    expect(screen.getByTestId("in").textContent).toBe("保存");
    expect(screen.getByTestId("out").textContent).toBe("保存");
    expect(document.documentElement.lang).toBe("ja");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("ja");
  });

  it("ko 辞書に無いキーは en にフォールバックする", async () => {
    const i18n = await loadI18n({ saved: "ko", preview: true });
    const { ko } = await import("./ko");
    // ko は全キーを訳してあるので、1 キーだけ一時的に抜いてフォールバックを確かめる
    const saved = ko["status.done"];
    delete ko["status.done"];
    try {
      expect(i18n.t("status.done")).toBe("Done");
    } finally {
      ko["status.done"] = saved;
    }
    expect(i18n.t("status.done")).toBe("완료");
  });
});

describe("生成言語と翻訳の目的言語", () => {
  it("UI が ko のとき、生成は en・翻訳の目的言語は ko のまま", async () => {
    const i18n = await loadI18n({ saved: "ko", preview: true });
    expect(i18n.getLocale()).toBe("ko");
    expect(i18n.getGenerationLanguage()).toBe("en");
  });

  it("ja / en は生成言語でもそのまま", async () => {
    const ja = await loadI18n({ saved: "ja" });
    expect(ja.getGenerationLanguage()).toBe("ja");
    const en = await loadI18n({ saved: "en" });
    expect(en.getGenerationLanguage()).toBe("en");
  });
});
