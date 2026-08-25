// TS 側 TYPE_TO_FOLDER と Rust 側 SHARED_ENTRY_TYPES（src-tauri/src/lib.rs の
// パストラバーサル許可リスト）のズレ検知。
//
// 2026-08-25: TS 側にだけ "knowledge" を追加して Rust 側の許可リストを更新し忘れ、
// Knowledge の共有が全件「無効な entry type: knowledge」で失敗した。
// 両者はビルドが別でコンパイラが跨いで検査できないため、ソースを読んで突き合わせる。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TYPE_TO_FOLDER } from "./local-folder";

describe("TYPE_TO_FOLDER ↔ Rust SHARED_ENTRY_TYPES parity", () => {
  it("folder names match the Rust allowlist exactly", () => {
    const rs = readFileSync(
      new URL("../../../../src-tauri/src/lib.rs", import.meta.url),
      "utf8",
    );
    const m = /const SHARED_ENTRY_TYPES[^=]*=\s*&\[([^\]]+)\]/.exec(rs);
    expect(m, "SHARED_ENTRY_TYPES not found in src-tauri/src/lib.rs").toBeTruthy();
    const rustFolders = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
    const tsFolders = Object.values(TYPE_TO_FOLDER).sort();
    expect(tsFolders).toEqual(rustFolders);
  });
});
