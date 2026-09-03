import { describe, it, expect } from "vitest";
import { normalizeCaptureName, parseInboxFolder } from "./naming";

const when = new Date("2026-09-03T10:15:30");

describe("送信名へのフォルダ埋め込み", () => {
  it("フォルダを指定すると名前に載る", () => {
    const name = normalizeCaptureName({
      mime: "image/jpeg",
      originalName: "IMG_0001.JPG",
      when,
      seq: 1,
      folder: "材料X",
    });
    expect(name.startsWith("graphium-20260903-101530-01~~")).toBe(true);
    expect(name.endsWith(".jpg")).toBe(true);
  });

  it("指定が無ければ今までどおりの名前", () => {
    const name = normalizeCaptureName({ mime: "image/jpeg", originalName: "a.jpg", when, seq: 1 });
    expect(name).toBe("graphium-20260903-101530-01.jpg");
  });

  it("空白だけの指定は付けない", () => {
    const name = normalizeCaptureName({
      mime: "image/jpeg", originalName: "a.jpg", when, seq: 1, folder: "   ",
    });
    expect(name).toBe("graphium-20260903-101530-01.jpg");
  });

  it("メモ / URL の捕獲ファイルには付けない（中身の JSON が運ぶ）", () => {
    const name = normalizeCaptureName({
      mime: "application/json",
      originalName: "graphium-x-url.graphium.json",
      when,
      seq: 1,
      folder: "材料X",
    });
    expect(name).toBe("graphium-20260903-101530-01-url.graphium.json");
  });
});

describe("parseInboxFolder", () => {
  it("埋め込んだフォルダを取り出し、名前からは外す", () => {
    const sent = normalizeCaptureName({
      mime: "image/png", originalName: "a.png", when, seq: 2, folder: "材料X",
    });
    expect(parseInboxFolder(sent)).toEqual({
      folder: "材料X",
      name: "graphium-20260903-101530-02.png",
    });
  });

  it("サブフォルダ（スラッシュ入り）も往復できる", () => {
    const sent = normalizeCaptureName({
      mime: "image/png", originalName: "a.png", when, seq: 1, folder: "プロジェクトA/実験1",
    });
    expect(parseInboxFolder(sent).folder).toBe("プロジェクトA/実験1");
  });

  it("埋め込みが無い名前はそのまま返す", () => {
    expect(parseInboxFolder("graphium-20260903-101530-01.jpg")).toEqual({
      name: "graphium-20260903-101530-01.jpg",
    });
  });

  it("人が置いた普通のファイル名も壊さない", () => {
    expect(parseInboxFolder("IMG_0001.JPG")).toEqual({ name: "IMG_0001.JPG" });
  });

  it("壊れたエンコードは「指定なし」として扱い、取り込み自体は通す", () => {
    const r = parseInboxFolder("graphium-20260903-101530-01~~%E4%B8.jpg");
    expect(r.folder).toBeUndefined();
    expect(r.name).toBe("graphium-20260903-101530-01.jpg");
  });

  it("区切りだけで中身が無い場合も名前を戻す", () => {
    expect(parseInboxFolder("graphium-20260903-101530-01~~.jpg")).toEqual({
      name: "graphium-20260903-101530-01.jpg",
    });
  });
});
