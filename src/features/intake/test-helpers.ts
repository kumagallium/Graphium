// テスト専用: File から IntakeFile を組み立てる共通ヘルパー
//
// IntakeFile は実体を getFile() で遅延取得する形になっているため、既に手元にある
// File を包むだけのテスト用ファクトリをここに集約する（各テストで File → IntakeFile
// への変換ロジックを重複させない）。

import type { IntakeFile } from "./types";

/** 既にある File 1 件を IntakeFile に包む。path 省略時は file.name をそのまま使う */
export function intakeFileFrom(file: File, path: string = file.name): IntakeFile {
  return { path, name: file.name, type: file.type, getFile: async () => file };
}
