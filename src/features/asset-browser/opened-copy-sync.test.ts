// 外のアプリで編集したコピーの取り込み方の判定のテスト

import { describe, expect, it } from "vitest";
import { decideAdoption, revisionPatch } from "./opened-copy-sync";
import type { MediaIndexEntry } from "./media-index";

const NONE = { snapshots: 0, templates: 0 };

function entryOf(patch: Partial<MediaIndexEntry> = {}): MediaIndexEntry {
  return {
    fileId: "m1",
    name: "proofing-plan.docx",
    type: "document",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    url: "file-media://m1",
    thumbnailUrl: "",
    uploadedAt: "2026-10-30T00:00:00Z",
    usedIn: [],
    ...patch,
  };
}

describe("decideAdoption", () => {
  it("どこからも引用されていなければ上書き", () => {
    expect(decideAdoption(entryOf(), NONE)).toBe("replace");
  });

  it("ノート・知識から使われていれば新しい版", () => {
    const used = entryOf({ usedIn: [{ noteId: "n1", noteTitle: "Bake day", blockId: "b1" }] });
    expect(decideAdoption(used, NONE)).toBe("new-version");
  });

  it("過去の版・テンプレート・共有のどれかにあれば新しい版", () => {
    expect(decideAdoption(entryOf(), { snapshots: 1, templates: 0 })).toBe("new-version");
    expect(decideAdoption(entryOf(), { snapshots: 0, templates: 2 })).toBe("new-version");
    const shared = entryOf({ sharedRef: { kind: "media" } as unknown as MediaIndexEntry["sharedRef"] });
    expect(decideAdoption(shared, NONE)).toBe("new-version");
  });
});

describe("revisionPatch", () => {
  it("元の版を記録し、フォルダと出どころを引き継ぐ", () => {
    const previous = entryOf({
      noteContexts: ["Sourdough"],
      sourceInfo: { authors: ["Baker"], origin: "manual" },
    });
    expect(revisionPatch(previous)).toEqual({
      revisionOf: "m1",
      derivedFromAssets: ["m1"],
      noteContexts: ["Sourdough"],
      sourceInfo: { authors: ["Baker"], origin: "manual" },
    });
  });

  it("人が付けた資料の日付を移す", () => {
    const patch = revisionPatch(entryOf({ sourceDate: "2012", sourceDateScanned: true }));
    expect(patch.sourceDate).toBe("2012");
    expect(patch.sourceDateFrom).toBeUndefined();
    expect(patch.sourceDateScanned).toBe(true);
  });

  it("人が外した資料の日付は、新しい版でも外したまま（中の作成日で上書きしない）", () => {
    const patch = revisionPatch(entryOf({ sourceDateScanned: true }));
    expect("sourceDate" in patch).toBe(true);
    expect(patch.sourceDate).toBeUndefined();
    expect(patch.sourceDateScanned).toBe(true);
    // 新しい版の登録で入った値に重ねると、日付が消える
    const merged = JSON.parse(JSON.stringify({ sourceDate: "2026-11-01", sourceDateFrom: "embedded", ...patch }));
    expect(merged.sourceDate).toBeUndefined();
    expect(merged.sourceDateFrom).toBeUndefined();
  });

  it("元の版で資料の日付を一度も読んでいなければ、新しい版の読み取りに任せる", () => {
    expect("sourceDate" in revisionPatch(entryOf())).toBe(false);
  });

  it("フォルダ・出どころが無ければ付けない", () => {
    expect(revisionPatch(entryOf())).toEqual({ revisionOf: "m1", derivedFromAssets: ["m1"] });
  });
});
