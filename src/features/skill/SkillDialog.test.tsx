// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, syncLocale } from "../../i18n";
import { SkillDialog } from "./SkillDialog";

describe("SkillDialog", () => {
  beforeEach(() => {
    syncLocale("ja");
  });

  it("Knowledge Schemaでは言語選択を表示せず保存言語を維持する", () => {
    const onSubmit = vi.fn();
    render(
      <LocaleProvider>
        <SkillDialog
          mode="edit"
          systemSkillId="knowledge-schema"
          initial={{
            title: "ナレッジスキーマ",
            description: "規約",
            availableForIngest: false,
            language: "ja",
          }}
          onClose={vi.fn()}
          onSubmit={onSubmit}
        />
      </LocaleProvider>,
    );

    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ language: "ja" }));
  });

  it("通常Skillでは言語選択を編集できる", () => {
    render(
      <LocaleProvider>
        <SkillDialog
          mode="edit"
          initial={{
            title: "Skill",
            description: "",
            availableForIngest: true,
            language: "en",
          }}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole("combobox")).toBeTruthy();
  });
});
