// classifyIntakeFiles のテスト
//
// notes / materials / skipped への振り分けを、拡張子・隠しパスの各パターンで確認する。

import { describe, it, expect } from "vitest";
import { classifyIntakeFiles } from "./classify";
import type { IntakeFile } from "./types";

function intakeFile(name: string, path: string, type: string): IntakeFile {
  return { file: new File(["dummy"], name, { type }), path };
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
});
