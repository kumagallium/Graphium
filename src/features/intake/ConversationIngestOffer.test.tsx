// @vitest-environment jsdom
// 候補の本数と費用の見込みの 1 行のテスト

import { useEffect } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { LocaleProvider, useLocale } from "../../i18n";
import { ConversationIngestOffer } from "./ConversationIngestOffer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => cleanup());

function Setter({ locale }: { locale: "ja" | "en" }) {
  const { setLocale } = useLocale();
  // マウント後に言語を合わせる（テスト用）
  useEffect(() => setLocale(locale), [locale, setLocale]);
  return null;
}

function text(locale: "ja" | "en", candidates: number, variant?: "full" | "short", leftOut?: number) {
  const { container } = render(
    <LocaleProvider>
      <Setter locale={locale} />
      <ConversationIngestOffer total={27} candidates={candidates} leftOut={leftOut} variant={variant} />
    </LocaleProvider>,
  );
  return container.textContent ?? "";
}

describe("ConversationIngestOffer", () => {
  it("日本語は万の単位で出す", () => {
    expect(text("ja", 4)).toContain("28〜36 万トークン");
  });

  it("英語は桁区切りの全数で出す", () => {
    expect(text("en", 4)).toContain("280,000–360,000 tokens");
  });

  it("候補 0 本は候補が無い文になる", () => {
    expect(text("ja", 0)).toContain("ナレッジ化の候補はありません");
  });

  it("外した本数があるときだけ、文の後ろに足す", () => {
    expect(text("ja", 4, "full", 3)).toContain("ノートにまとめた 3 本は候補から外しました");
    expect(text("en", 4, "full", 3)).toContain("Left out 3 already saved as notes");
    expect(text("ja", 4, "full", 0)).not.toContain("ノートにまとめた");
  });

  it("候補が 0 本でも外した本数は伝える", () => {
    expect(text("ja", 0, "full", 2)).toContain("ノートにまとめた 2 本は候補から外しました");
  });
});
