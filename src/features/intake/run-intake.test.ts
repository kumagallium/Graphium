// runIntake のテスト
//
// 偽の deps（importMarkdown / uploadAsset）で、進捗の単調増加・失敗時の継続・
// skipped の集計を確認する。

import { describe, it, expect, vi } from "vitest";
import { runIntake, type IntakeDeps, type IntakeProgress, type MarkdownImportResult } from "./run-intake";
import type { IntakeFile } from "./types";

function mdFile(name: string): IntakeFile {
  return { file: new File(["# " + name], name, { type: "text/markdown" }), path: name };
}
function pdfFile(name: string): IntakeFile {
  return { file: new File(["dummy"], name, { type: "application/pdf" }), path: name };
}
function otherFile(name: string): IntakeFile {
  return { file: new File(["dummy"], name, { type: "" }), path: name };
}

function makeDeps(overrides: Partial<IntakeDeps> = {}): IntakeDeps {
  const importMarkdown = vi.fn(
    async (files: IntakeFile[], onProgress: (p: IntakeProgress) => void): Promise<MarkdownImportResult> => {
      for (let i = 0; i < files.length; i++) {
        onProgress({ done: i + 1, total: files.length, current: files[i].file.name, failed: [] });
      }
      return {
        created: files.length,
        linksResolved: 0,
        linksUnresolved: 0,
        failed: [],
        lastNewId: files.length > 0 ? "note-last" : null,
      };
    },
  );
  const uploadAsset = vi.fn(async (_file: File) => ({}));
  return { importMarkdown, uploadAsset, ...overrides };
}

describe("runIntake", () => {
  it("md 3 + pdf 2 の通常ケース: 進捗の done が単調増加して最後に total に達する", async () => {
    const files = [mdFile("a.md"), mdFile("b.md"), mdFile("c.md"), pdfFile("d.pdf"), pdfFile("e.pdf")];
    const deps = makeDeps();
    const progresses: IntakeProgress[] = [];

    const outcome = await runIntake(files, deps, (p) => progresses.push(p));

    expect(outcome.notes).toBe(3);
    expect(outcome.materials).toBe(2);
    expect(outcome.skipped).toBe(0);
    expect(outcome.failed).toEqual([]);

    // done は単調増加
    const doneSeq = progresses.map((p) => p.done);
    for (let i = 1; i < doneSeq.length; i++) {
      expect(doneSeq[i]).toBeGreaterThanOrEqual(doneSeq[i - 1]);
    }
    expect(doneSeq[doneSeq.length - 1]).toBe(5);
    expect(progresses.every((p) => p.total === 5)).toBe(true);

    // importMarkdown には classify 前の全ファイル（notes + materials）が
    // ctx.allFiles として渡る（画像参照の解決に使うため）
    expect(deps.importMarkdown).toHaveBeenCalledWith(expect.any(Array), expect.any(Function), { allFiles: files });
  });

  it("uploadAsset が 1 件 throw しても止まらず failed に入る", async () => {
    const files = [mdFile("a.md"), pdfFile("ok.pdf"), pdfFile("bad.pdf")];
    const uploadAsset = vi.fn(async (file: File) => {
      if (file.name === "bad.pdf") throw new Error("upload failed");
      return {};
    });
    const deps = makeDeps({ uploadAsset });

    const outcome = await runIntake(files, deps, () => {});

    expect(outcome.materials).toBe(1);
    expect(outcome.failed).toEqual(["bad.pdf"]);
  });

  it("対象外ファイルが skipped に数えられる", async () => {
    const files = [mdFile("a.md"), pdfFile("b.pdf"), otherFile("mystery.xyz")];
    const deps = makeDeps();

    const outcome = await runIntake(files, deps, () => {});

    expect(outcome.skipped).toBe(1);
    expect(outcome.notes).toBe(1);
    expect(outcome.materials).toBe(1);
  });
});

describe("runIntake の堅牢性", () => {
  it("importMarkdown が丸ごと throw しても notes 全件を失敗にして素材登録まで進む", async () => {
    const files = [mdFile("a.md"), mdFile("b.md"), pdfFile("c.pdf")];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      importMarkdown: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
    });

    const outcome = await runIntake(files, deps, () => {});

    expect(outcome.notes).toBe(0);
    expect(outcome.failed).toEqual(["a.md", "b.md"]);
    expect(outcome.materials).toBe(1);
    expect(deps.uploadAsset).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("notes が 0 件なら importMarkdown を呼ばない", async () => {
    const deps = makeDeps();
    const outcome = await runIntake([pdfFile("c.pdf")], deps, () => {});
    expect(deps.importMarkdown).not.toHaveBeenCalled();
    expect(outcome.materials).toBe(1);
  });

  it("afterRun が throw しても結果は返る", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({
      afterRun: async () => {
        throw new Error("refresh failed");
      },
    });
    const outcome = await runIntake([mdFile("a.md")], deps, () => {});
    expect(outcome.notes).toBe(1);
    warn.mockRestore();
  });
});
