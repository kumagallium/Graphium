// @vitest-environment jsdom
//
// ロケールの公開方針・検出・切替のテスト。
//
// 起動時の検出（保存値 → ブラウザの言語）はモジュール読み込み時に 1 回だけ走るので、
// 条件ごとにモジュールを読み直して確かめる（index.test.ts は en に戻してから使うため、
// 検出そのものは見ていない）。
// 公開前ロケールの扱いは、今は公開前のロケールが無いので、方針を差し替えられる
// 純関数（isLocaleAllowed / resolveInitialLocale）で確かめる。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, act, cleanup, screen } from "@testing-library/react";
import { isLocaleAllowed, resolveInitialLocale, type Locale, type LocalePolicy } from "./index";

const STORAGE_KEY = "graphium_locale";

type Setup = {
  /** localStorage に入っている言語（undefined なら無し） */
  saved?: string;
  /** navigator.language */
  browser?: string;
};

async function loadI18n({ saved, browser = "en-US" }: Setup) {
  vi.resetModules();
  localStorage.clear();
  if (saved !== undefined) localStorage.setItem(STORAGE_KEY, saved);
  vi.spyOn(navigator, "language", "get").mockReturnValue(browser);
  return await import("./index");
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.clear();
});

// ko が公開前だったころと同じ形の方針（ko だけ試験扱い）
const previewKo = (previewOn: boolean): LocalePolicy => ({
  released: new Set<Locale>(["en", "ja"]),
  preview: new Set<Locale>(["ko"]),
  previewOn,
});
const allowedBy = (policy: LocalePolicy) => (v: string): v is Locale => isLocaleAllowed(v, policy);

describe("公開前ロケールの扱い（方針を差し替えて確かめる）", () => {
  it("試験有効化していなければ使えない", () => {
    expect(isLocaleAllowed("ko", previewKo(false))).toBe(false);
    expect(isLocaleAllowed("ja", previewKo(false))).toBe(true);
  });

  it("試験有効化すると使える", () => {
    expect(isLocaleAllowed("ko", previewKo(true))).toBe(true);
  });

  it("辞書の無いロケールはどの方針でも使えない", () => {
    expect(isLocaleAllowed("xx", previewKo(true))).toBe(false);
  });

  it("ブラウザの言語が公開前ロケールでも、それにはならない", () => {
    expect(resolveInitialLocale(null, "ko-KR", allowedBy(previewKo(false)))).toBe("en");
  });

  it("保存値が公開前ロケールなら en で表示する（保存値は呼び出し側が書き換えない）", () => {
    expect(resolveInitialLocale("ko", "ja-JP", allowedBy(previewKo(false)))).toBe("en");
    expect(resolveInitialLocale("ko", "ja-JP", allowedBy(previewKo(true)))).toBe("ko");
  });

  it("開発ビルドでなければ VITE_ENABLE_PREVIEW_LOCALES=true でも試験有効化しない", async () => {
    vi.stubEnv("VITE_ENABLE_PREVIEW_LOCALES", "true");
    vi.stubEnv("DEV", false);
    const i18n = await loadI18n({});
    expect(i18n.previewLocalesEnabled()).toBe(false);
    vi.stubEnv("DEV", true);
    expect(i18n.previewLocalesEnabled()).toBe(true);
  });
});

describe("ko（公開済み）", () => {
  it("選択肢に en / ja / ko が並ぶ", async () => {
    const i18n = await loadI18n({});
    expect(i18n.getEnabledLocales()).toEqual(["en", "ja", "ko"]);
  });

  it("ブラウザが ko-KR なら ko になり、<html lang> も ko", async () => {
    const i18n = await loadI18n({ browser: "ko-KR" });
    expect(i18n.getLocale()).toBe("ko");
    expect(document.documentElement.lang).toBe("ko");
  });

  it("保存値 ko を復元する（再起動しても保たれる）", async () => {
    const i18n = await loadI18n({ saved: "ko", browser: "ja-JP" });
    expect(i18n.getLocale()).toBe("ko");
  });

  it("en → ko → ja の切替が Context の内外と <html lang> に反映され、保存される", async () => {
    const i18n = await loadI18n({ saved: "en" });
    let setLocale: (l: Locale) => void = () => {};
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
    const i18n = await loadI18n({ saved: "ko" });
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

describe("生成言語と翻訳の目的言語", () => {
  it("UI が ko のとき、生成は en・翻訳の目的言語は ko のまま", async () => {
    const i18n = await loadI18n({ saved: "ko" });
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
