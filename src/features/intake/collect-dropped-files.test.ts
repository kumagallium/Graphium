// collectDroppedFiles のテスト
//
// - フォルダの再帰的な収集（readEntries が空になるまで繰り返し呼ばれる）
// - webkitGetAsEntry が使えない環境でのフォールバック（dt.files を素通し）

import { describe, it, expect, vi } from "vitest";
import { collectDroppedFiles } from "./collect-dropped-files";

type FakeEntry = {
  isFile: boolean;
  isDirectory: boolean;
  fullPath: string;
  file?: (success: (f: File) => void) => void;
  createReader?: () => { readEntries: (success: (entries: FakeEntry[]) => void) => void };
};

function fakeFileEntry(fullPath: string, file: File): FakeEntry {
  return {
    isFile: true,
    isDirectory: false,
    fullPath,
    file: (success) => success(file),
  };
}

function fakeDirEntry(fullPath: string, batches: FakeEntry[][]): FakeEntry {
  let call = 0;
  return {
    isFile: false,
    isDirectory: true,
    fullPath,
    createReader: () => ({
      readEntries: (success) => {
        const batch = batches[call] ?? [];
        call += 1;
        success(batch);
      },
    }),
  };
}

function makeDataTransfer(entries: (FakeEntry | null)[], fallbackFiles: File[] = []): DataTransfer {
  const items = entries.map((entry) => ({
    webkitGetAsEntry: () => entry,
  }));
  return {
    items,
    files: fallbackFiles,
  } as unknown as DataTransfer;
}

describe("collectDroppedFiles", () => {
  it("フォルダを再帰的に辿り、readEntries が空になるまで繰り返し呼ぶ", async () => {
    const a = fakeFileEntry("/vault/a.md", new File(["a"], "a.md"));
    const b = fakeFileEntry("/vault/sub/b.md", new File(["b"], "b.md"));
    const c = fakeFileEntry("/vault/sub/c.md", new File(["c"], "c.md"));
    const readEntriesSpy = vi.fn();

    const subDir = fakeDirEntry("/vault/sub", [[b], [c], []]);
    // 1 回目に一部・2 回目に残り・3 回目に空、を検証するためスパイでラップ
    const originalCreateReader = subDir.createReader!;
    subDir.createReader = () => {
      const reader = originalCreateReader();
      const original = reader.readEntries;
      reader.readEntries = (success) => {
        readEntriesSpy();
        original(success);
      };
      return reader;
    };

    const rootDir = fakeDirEntry("/vault", [[a, subDir], []]);

    const dt = makeDataTransfer([rootDir]);
    const files = await collectDroppedFiles(dt);

    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(["vault/a.md", "vault/sub/b.md", "vault/sub/c.md"]);
    // sub ディレクトリの readEntries は 3 回呼ばれている（空が返るまで）
    expect(readEntriesSpy).toHaveBeenCalledTimes(3);
  });

  it("webkitGetAsEntry が使えない環境では dt.files をそのまま返す", async () => {
    const f1 = new File(["x"], "note.md");
    const f2 = new File(["y"], "photo.png");
    const dt = makeDataTransfer([null], [f1, f2]);

    const files = await collectDroppedFiles(dt);

    expect(files.map((f) => f.file)).toEqual([f1, f2]);
    expect(files.map((f) => f.path)).toEqual(["note.md", "photo.png"]);
  });
});
