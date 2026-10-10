// @vitest-environment jsdom
// 「構造」節の Asterism ブロック: 連携オフなら、書き込み済みの値があっても出さない
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import type { WikiMeta } from "../../lib/document-types";
import type { AsterismSettings } from "../settings/store";
import { WikiFrameSection } from "./WikiFrameSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

const conf: AsterismSettings = {
  vocabBaseIri: "https://example.org/vocab#",
  typeSlugs: { rule: "rule" },
  claimBaseIri: "https://example.org/claim/",
} as AsterismSettings;

const meta = {
  kind: "claim",
  statementForm: "general",
  ruleFrame: { conditions: [{ text: "a" }], consequences: [{ text: "b" }], reviewState: "confirmed" },
  asterism: { typeSlug: "rule", typeSlugBy: "auto" },
} as unknown as WikiMeta;

const renderSection = (enabled: boolean) =>
  render(
    <LocaleProvider>
      <WikiFrameSection wikiMeta={meta} asterismSettings={conf} asterismEnabled={enabled} defaultOpen />
    </LocaleProvider>,
  );

describe("WikiFrameSection の Asterism ブロック", () => {
  it("連携オフでは型の select が出ない", () => {
    const { container } = renderSection(false);
    expect(container.querySelector("select")).toBeNull();
  });
  it("連携オンでは型の select が出る", () => {
    const { container } = renderSection(true);
    expect(container.querySelector("select")).not.toBeNull();
  });
});
