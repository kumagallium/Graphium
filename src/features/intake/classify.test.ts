// classifyIntakeFiles のテスト
//
// notes / materials / skipped への振り分けを、拡張子・隠しパスの各パターンで確認する。

import { describe, it, expect } from "vitest";
import { classifyIntakeFiles, INTAKE_EXTENSIONS } from "./classify";
import type { IntakeFile } from "./types";
import { intakeFileFrom } from "./test-helpers";

function intakeFile(name: string, path: string, type: string): IntakeFile {
  return intakeFileFrom(new File(["dummy"], name, { type }), path);
}

describe("classifyIntakeFiles", () => {
  it("Markdown はノートに分類される", () => {
    const f = intakeFile("note.md", "note.md", "text/markdown");
    const result = classifyIntakeFiles([f]);
    expect(result.notes).toEqual([f]);
    expect(result.materials).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("PDF は素材に分類される", () => {
    const f = intakeFile("paper.pdf", "paper.pdf", "application/pdf");
    const result = classifyIntakeFiles([f]);
    expect(result.materials).toEqual([f]);
  });

  it("画像は素材に分類される", () => {
    const f = intakeFile("photo.png", "photo.png", "image/png");
    const result = classifyIntakeFiles([f]);
    expect(result.materials).toEqual([f]);
  });

  it("CSV は区切りテキストとして素材に分類される", () => {
    const f = intakeFile("data.csv", "data.csv", "text/csv");
    const result = classifyIntakeFiles([f]);
    expect(result.materials).toEqual([f]);
  });

  it(".obsidian 配下のファイルは対象外", () => {
    const f = intakeFile("app.json", ".obsidian/app.json", "application/json");
    const result = classifyIntakeFiles([f]);
    expect(result.skipped).toEqual([f]);
  });

  it("パス途中がドット始まりの隠しファイルも対象外（notes/.hidden.md）", () => {
    // 拡張子は .md だが、隠しパスの判定を先に見るため notes 扱いにはしない
    const f = intakeFile(".hidden.md", "notes/.hidden.md", "text/markdown");
    const result = classifyIntakeFiles([f]);
    expect(result.skipped).toEqual([f]);
    expect(result.notes).toEqual([]);
  });

  it("readme.txt は isDelimitedDataFile の対象拡張子（.txt）のため素材扱い", () => {
    const f = intakeFile("readme.txt", "readme.txt", "text/plain");
    const result = classifyIntakeFiles([f]);
    expect(result.materials).toEqual([f]);
    expect(result.skipped).toEqual([]);
  });

  it("拡張子不明のファイルは対象外", () => {
    const f = intakeFile("mystery.xyz", "mystery.xyz", "");
    const result = classifyIntakeFiles([f]);
    expect(result.skipped).toEqual([f]);
  });

  it("type が空の PDF（ドロップ由来）は拡張子から推定して素材に分類される", () => {
    const f = intakeFile("paper.pdf", "paper.pdf", "");
    const result = classifyIntakeFiles([f]);
    expect(result.materials).toEqual([f]);
    expect(result.skipped).toEqual([]);
  });

  it("type が空で拡張子も不明なファイルは対象外", () => {
    const f = intakeFile("x.unknownext", "x.unknownext", "");
    const result = classifyIntakeFiles([f]);
    expect(result.skipped).toEqual([f]);
  });

  it("PowerPoint（type 空）は素材に分類される（拡張子から推定）", () => {
    const f = intakeFile("paper.pptx", "paper.pptx", "");
    const result = classifyIntakeFiles([f]);
    expect(result.materials).toEqual([f]);
    expect(result.skipped).toEqual([]);
  });

  it("Excel は素材に分類される", () => {
    const f = intakeFile(
      "sheet.xlsx",
      "sheet.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const result = classifyIntakeFiles([f]);
    expect(result.materials).toEqual([f]);
  });

  it("Word (.docx) は素材に分類される", () => {
    const f = intakeFile(
      "report.docx",
      "report.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const result = classifyIntakeFiles([f]);
    expect(result.materials).toEqual([f]);
  });

  it("旧形式の Word (.doc) は対象外（docx のみ素材扱い）", () => {
    const f = intakeFile("old.doc", "old.doc", "application/msword");
    const result = classifyIntakeFiles([f]);
    expect(result.skipped).toEqual([f]);
  });

  it("旧形式の Excel (.xls) は対象外", () => {
    const f = intakeFile("old.xls", "old.xls", "application/vnd.ms-excel");
    const result = classifyIntakeFiles([f]);
    expect(result.skipped).toEqual([f]);
  });

  it("旧形式の PowerPoint (.ppt) は対象外", () => {
    const f = intakeFile("old.ppt", "old.ppt", "application/vnd.ms-powerpoint");
    const result = classifyIntakeFiles([f]);
    expect(result.skipped).toEqual([f]);
  });
});

describe("INTAKE_EXTENSIONS（ネイティブ走査に渡す拡張子）", () => {
  it("取り込める形式を含み、展開できない旧 Office 形式は含まない", () => {
    for (const ext of ["md", "markdown", "pdf", "png", "mp4", "csv", "docx", "pptx", "xlsx"]) {
      expect(INTAKE_EXTENSIONS).toContain(ext);
    }
    for (const ext of ["doc", "xls", "ppt", "zip"]) {
      expect(INTAKE_EXTENSIONS).not.toContain(ext);
    }
  });

  it("一覧のどの拡張子も、MIME 無し（ネイティブ走査と同じ条件）で対象外にならない", () => {
    const files = INTAKE_EXTENSIONS.map((ext) => intakeFileFrom(new File(["x"], `f.${ext}`, { type: "" })));
    expect(classifyIntakeFiles(files).skipped.map((f) => f.name)).toEqual([]);
  });
});
