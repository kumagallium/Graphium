// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, syncLocale } from "../../i18n";
import { SkillBanner } from "./SkillBanner";

describe("SkillBanner", () => {
  beforeEach(() => {
    syncLocale("ja");
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("Knowledge Schemaを開くと現在と反対の言語への切替を表示する", () => {
    render(
      <LocaleProvider>
        <SkillBanner
          availableForIngest={false}
          systemSkillId="knowledge-schema"
          language="en"
          onEdit={vi.fn()}
          onSwitchKnowledgeSchemaLanguage={vi.fn()}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole("button", { name: "日本語版に切替" })).toBeTruthy();
  });

  it("確認をキャンセルすると切替を実行しない", () => {
    const onSwitch = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <LocaleProvider>
        <SkillBanner
          availableForIngest={false}
          systemSkillId="knowledge-schema"
          language="ja"
          onEdit={vi.fn()}
          onSwitchKnowledgeSchemaLanguage={onSwitch}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "英語版に切替" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("復元可能な改訂版"));
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("確認すると対象言語への切替を実行する", async () => {
    const onSwitch = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <LocaleProvider>
        <SkillBanner
          availableForIngest={false}
          systemSkillId="knowledge-schema"
          language="ja"
          onEdit={vi.fn()}
          onSwitchKnowledgeSchemaLanguage={onSwitch}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "英語版に切替" }));

    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith("en"));
  });

  it("通常Skillには言語切替を表示しない", () => {
    render(
      <LocaleProvider>
        <SkillBanner
          availableForIngest
          language="ja"
          onEdit={vi.fn()}
          onSwitchKnowledgeSchemaLanguage={vi.fn()}
        />
      </LocaleProvider>,
    );

    expect(screen.queryByText("英語版に切替")).toBeNull();
  });
});
