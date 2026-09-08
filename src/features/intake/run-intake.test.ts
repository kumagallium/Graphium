// runIntake のテスト
//
// 偽の deps（importMarkdown / uploadAsset）で、進捗の単調増加・失敗時の継続・
// skipped の集計を確認する。

import { describe, it, expect, vi } from "vitest";
import { runIntake, mergeOutcome, type IntakeDeps, type IntakeOutcome, type IntakeProgress, type MarkdownImportResult } from "./run-intake";
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
        existing: 0,
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
    expect(deps.importMarkdown).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Function),
      { allFiles: files, folderOf: expect.any(Function) },
    );
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

  it("skippedByExt が拡張子ごとに数えられる（旧形式 .ppt/.xls は対象外のまま）", async () => {
    const files = [
      otherFile("a.ppt"),
      otherFile("b.ppt"),
      otherFile("c.xls"),
      otherFile("d.bak"),
    ];
    const deps = makeDeps();

    const outcome = await runIntake(files, deps, () => {});

    expect(outcome.skippedByExt).toEqual({ ".ppt": 2, ".xls": 1, ".bak": 1 });
  });

  it("materialsExisting が uploadAsset の duplicate:true 件数を数える", async () => {
    const files = [pdfFile("new.pdf"), pdfFile("existing.pdf")];
    const uploadAsset = vi.fn(async (file: File) => ({
      duplicate: file.name === "existing.pdf",
    }));
    const deps = makeDeps({ uploadAsset });

    const outcome = await runIntake(files, deps, () => {});

    expect(outcome.materials).toBe(2);
    expect(outcome.materialsExisting).toBe(1);
  });

  it("notesExisting が importMarkdown の existing をそのまま反映する（同じファイルを入れ直したノート数）", async () => {
    const files = [mdFile("a.md"), mdFile("b.md")];
    const importMarkdown = vi.fn(
      async (fs: IntakeFile[]): Promise<MarkdownImportResult> => ({
        created: 1,
        existing: 1,
        linksResolved: 0,
        linksUnresolved: 0,
        failed: [],
        lastNewId: "note-a",
      }),
    );
    const deps = makeDeps({ importMarkdown });

    const outcome = await runIntake(files, deps, () => {});

    expect(outcome.notes).toBe(1);
    expect(outcome.notesExisting).toBe(1);
  });

  it("フォルダの引き継ぎ: 根配下の md 2（別フォルダ）+ png 1（同フォルダ）で folders が 2、setAssetFolder が新規素材にだけ呼ばれる", async () => {
    function file(path: string): IntakeFile {
      return { file: new File(["dummy"], path.split("/").pop()!), path };
    }
    const files = [
      file("Vault/研究/a.md"),
      file("Vault/日記/b.md"),
      file("Vault/研究/fig.png"),
    ];
    const setAssetFolder = vi.fn();
    const uploadAsset = vi.fn(async (file: File) => ({ fileId: `id-${file.name}`, duplicate: false }));
    const deps = makeDeps({ uploadAsset, setAssetFolder });

    const outcome = await runIntake(files, deps, () => {});

    expect(outcome.folders).toBe(2);
    expect(setAssetFolder).toHaveBeenCalledTimes(1);
    expect(setAssetFolder).toHaveBeenCalledWith("id-fig.png", "研究");
  });

  it("pptx/xlsx の新規登録には expandOffice が呼ばれ、officeDerived に合算される", async () => {
    function officeFile(name: string): IntakeFile {
      return { file: new File(["dummy"], name, { type: "" }), path: name };
    }
    const files = [officeFile("slides.pptx"), officeFile("sheet.xlsx")];
    const uploadAsset = vi.fn(async (file: File) => ({ fileId: `id-${file.name}`, duplicate: false }));
    const expandOffice = vi.fn(async (_file: File, fileId: string) => ({
      derived: fileId === "id-slides.pptx" ? 2 : 3,
      skipped: 0,
    }));
    const deps = makeDeps({ uploadAsset, expandOffice });

    const outcome = await runIntake(files, deps, () => {});

    expect(expandOffice).toHaveBeenCalledTimes(2);
    expect(outcome.officeDerived).toBe(5);
  });

  it("expandOffice の skipped（変換できなかった画像件数）は officeSkipped に合算される", async () => {
    function officeFile(name: string): IntakeFile {
      return { file: new File(["dummy"], name, { type: "" }), path: name };
    }
    const files = [officeFile("slides.pptx"), officeFile("sheet.xlsx")];
    const uploadAsset = vi.fn(async (file: File) => ({ fileId: `id-${file.name}`, duplicate: false }));
    const expandOffice = vi.fn(async (_file: File, fileId: string) => ({
      derived: fileId === "id-slides.pptx" ? 2 : 3,
      skipped: fileId === "id-slides.pptx" ? 1 : 0,
    }));
    const deps = makeDeps({ uploadAsset, expandOffice });

    const outcome = await runIntake(files, deps, () => {});

    expect(outcome.officeSkipped).toBe(1);
  });

  it("重複登録（duplicate）の pptx/xlsx には isOfficeExpanded 未指定なら expandOffice を呼ばない", async () => {
    function officeFile(name: string): IntakeFile {
      return { file: new File(["dummy"], name, { type: "" }), path: name };
    }
    const files = [officeFile("slides.pptx")];
    const uploadAsset = vi.fn(async (file: File) => ({ fileId: `id-${file.name}`, duplicate: true }));
    const expandOffice = vi.fn(async () => ({ derived: 2, skipped: 0 }));
    const deps = makeDeps({ uploadAsset, expandOffice });

    const outcome = await runIntake(files, deps, () => {});

    expect(expandOffice).not.toHaveBeenCalled();
    expect(outcome.officeDerived).toBe(0);
  });

  it("重複登録（duplicate）でも isOfficeExpanded が false（未展開）なら expandOffice を呼ぶ", async () => {
    function officeFile(name: string): IntakeFile {
      return { file: new File(["dummy"], name, { type: "" }), path: name };
    }
    const files = [officeFile("slides.pptx")];
    const uploadAsset = vi.fn(async (file: File) => ({ fileId: `id-${file.name}`, duplicate: true }));
    const expandOffice = vi.fn(async () => ({ derived: 2, skipped: 0 }));
    const isOfficeExpanded = vi.fn(() => false);
    const deps = makeDeps({ uploadAsset, expandOffice, isOfficeExpanded });

    const outcome = await runIntake(files, deps, () => {});

    expect(expandOffice).toHaveBeenCalledTimes(1);
    expect(outcome.officeDerived).toBe(2);
  });

  it("重複登録（duplicate）で isOfficeExpanded が true（展開済み）なら expandOffice を呼ばない", async () => {
    function officeFile(name: string): IntakeFile {
      return { file: new File(["dummy"], name, { type: "" }), path: name };
    }
    const files = [officeFile("slides.pptx")];
    const uploadAsset = vi.fn(async (file: File) => ({ fileId: `id-${file.name}`, duplicate: true }));
    const expandOffice = vi.fn(async () => ({ derived: 2, skipped: 0 }));
    const isOfficeExpanded = vi.fn(() => true);
    const deps = makeDeps({ uploadAsset, expandOffice, isOfficeExpanded });

    const outcome = await runIntake(files, deps, () => {});

    expect(expandOffice).not.toHaveBeenCalled();
    expect(outcome.officeDerived).toBe(0);
  });

  it("expandOffice が throw しても取り込みは継続する", async () => {
    function officeFile(name: string): IntakeFile {
      return { file: new File(["dummy"], name, { type: "" }), path: name };
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const files = [officeFile("slides.pptx")];
    const uploadAsset = vi.fn(async (file: File) => ({ fileId: `id-${file.name}`, duplicate: false }));
    const expandOffice = vi.fn(async () => {
      throw new Error("展開失敗");
    });
    const deps = makeDeps({ uploadAsset, expandOffice });

    const outcome = await runIntake(files, deps, () => {});

    expect(outcome.materials).toBe(1);
    expect(outcome.officeDerived).toBe(0);
    expect(outcome.failed).toEqual([]);
    warn.mockRestore();
  });

  it("フォルダの引き継ぎ: 登録済み（duplicate）の素材には setAssetFolder を呼ばない", async () => {
    function file(path: string): IntakeFile {
      return { file: new File(["dummy"], path.split("/").pop()!), path };
    }
    const files = [file("Vault/研究/fig.png")];
    const setAssetFolder = vi.fn();
    const uploadAsset = vi.fn(async (file: File) => ({ fileId: `id-${file.name}`, duplicate: true }));
    const deps = makeDeps({ uploadAsset, setAssetFolder });

    await runIntake(files, deps, () => {});

    expect(setAssetFolder).not.toHaveBeenCalled();
  });

  it("ocrTargets: 新規登録した画像は積み、PDF は積まない", async () => {
    const files = [pdfFile("doc.pdf")];
    function imageFile(name: string): IntakeFile {
      return { file: new File(["dummy"], name, { type: "image/png" }), path: name };
    }
    const uploadAsset = vi.fn(async (file: File) => ({
      fileId: `id-${file.name}`,
      duplicate: false,
      entry: {
        fileId: `id-${file.name}`,
        name: file.name,
        type: file.type.startsWith("image/") ? "image" : "pdf",
        mimeType: file.type,
        url: `url-${file.name}`,
        thumbnailUrl: "",
        uploadedAt: new Date().toISOString(),
        usedIn: [],
      },
    }));
    const deps = makeDeps({ uploadAsset });

    const outcome = await runIntake([...files, imageFile("pic.png")], deps, () => {});

    expect(outcome.ocrTargets).toEqual([{ fileId: "id-pic.png", url: "url-pic.png", name: "pic.png" }]);
  });

  it("ocrTargets: 既存（duplicate）でも ocrText が無ければ積む。あれば積まない", async () => {
    function imageFile(name: string): IntakeFile {
      return { file: new File(["dummy"], name, { type: "image/png" }), path: name };
    }
    const uploadAsset = vi.fn(async (file: File) => ({
      fileId: `id-${file.name}`,
      duplicate: true,
      entry: {
        fileId: `id-${file.name}`,
        name: file.name,
        type: "image",
        mimeType: "image/png",
        url: `url-${file.name}`,
        thumbnailUrl: "",
        uploadedAt: new Date().toISOString(),
        usedIn: [],
        ...(file.name === "already-read.png" ? { ocrText: "既に読めている" } : {}),
      },
    }));
    const deps = makeDeps({ uploadAsset });

    const outcome = await runIntake(
      [imageFile("not-yet.png"), imageFile("already-read.png")],
      deps,
      () => {},
    );

    expect(outcome.ocrTargets).toEqual([{ fileId: "id-not-yet.png", url: "url-not-yet.png", name: "not-yet.png" }]);
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

describe("mergeOutcome", () => {
  it("notes/materials/materialsExisting/links/skipped を加算し、skippedByExt はキーごとに加算、failed は連結、lastNewId は後勝ち", () => {
    const a: IntakeOutcome = {
      notes: 2,
      notesExisting: 1,
      materials: 1,
      materialsExisting: 1,
      linksResolved: 3,
      linksUnresolved: 1,
      failed: ["a.md"],
      skipped: 1,
      skippedByExt: { ".pptx": 1 },
      lastNewId: "note-a",
      folders: 2,
      ocrTargets: [{ fileId: "img-a", url: "url-a", name: "a.png" }],
      officeDerived: 4,
      officeSkipped: 1,
    };
    const b: IntakeOutcome = {
      notes: 1,
      notesExisting: 0,
      materials: 2,
      materialsExisting: 0,
      linksResolved: 0,
      linksUnresolved: 2,
      failed: ["b.pdf"],
      skipped: 0,
      skippedByExt: { ".pptx": 1, ".xlsx": 1 },
      lastNewId: null,
      folders: 1,
      ocrTargets: [{ fileId: "img-b", url: "url-b", name: "b.png" }],
      officeDerived: 2,
      officeSkipped: 2,
    };

    const merged = mergeOutcome(a, b);

    expect(merged).toEqual({
      notes: 3,
      notesExisting: 1,
      materials: 3,
      materialsExisting: 1,
      linksResolved: 3,
      linksUnresolved: 3,
      failed: ["a.md", "b.pdf"],
      skipped: 1,
      skippedByExt: { ".pptx": 2, ".xlsx": 1 },
      // b の lastNewId が null なので a を保つ
      lastNewId: "note-a",
      // folders は集合を持たないので加算で近似する
      folders: 3,
      // ocrTargets は連結
      ocrTargets: [
        { fileId: "img-a", url: "url-a", name: "a.png" },
        { fileId: "img-b", url: "url-b", name: "b.png" },
      ],
      officeDerived: 6,
      officeSkipped: 3,
    });
  });
});
