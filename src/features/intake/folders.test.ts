// folders.ts のテスト（フォルダ引き継ぎの規則: 「フォルダの中の並びは、そのままフォルダになります」）

import { describe, it, expect } from "vitest";
import { commonRootOf, folderOf } from "./folders";
import type { IntakeFile } from "./types";

function f(path: string): IntakeFile {
  return { file: new File(["dummy"], path.split("/").pop()!), path };
}

describe("commonRootOf", () => {
  it("単一のフォルダを落とした場合はその名前を根として返す", () => {
    const files = [f("Vault/研究/2024/メモ.md"), f("Vault/メモ.md"), f("Vault/研究/attachments/fig.png")];
    expect(commonRootOf(files)).toBe("Vault");
  });

  it("根が 2 つ（フォルダを 2 つ同時に落とした）場合は null", () => {
    const files = [f("A/x.md"), f("B/y.md")];
    expect(commonRootOf(files)).toBeNull();
  });

  it("単体ファイル（path に \"/\" が無い）が混ざると null", () => {
    const files = [f("Vault/研究/メモ.md"), f("x.md")];
    expect(commonRootOf(files)).toBeNull();
  });

  it("単体ファイルのみでも null", () => {
    expect(commonRootOf([f("x.md")])).toBeNull();
  });
});

describe("folderOf", () => {
  it("単一の根を落とした場合の例: 研究/2024 が残る", () => {
    expect(folderOf("Vault/研究/2024/メモ.md", "Vault")).toBe("研究/2024");
  });

  it("根直下のファイルは未分類（undefined）", () => {
    expect(folderOf("Vault/メモ.md", "Vault")).toBeUndefined();
  });

  it("深さは切らない: 残りがそのまま文字列になる", () => {
    expect(folderOf("Vault/研究/attachments/fig.png", "Vault")).toBe("研究/attachments");
  });

  it("根が null の場合は先頭セグメントがそのままフォルダ名になる（フォルダ 2 つ同時ドロップ）", () => {
    expect(folderOf("A/x.md", null)).toBe("A");
    expect(folderOf("B/y.md", null)).toBe("B");
  });

  it("単体ファイル（\"/\" 無し・root null）は undefined", () => {
    expect(folderOf("x.md", null)).toBeUndefined();
  });

  it("ドット始まりのパスも普通に扱う", () => {
    expect(folderOf("Vault/.obsidian/app.json", "Vault")).toBe(".obsidian");
  });
});
