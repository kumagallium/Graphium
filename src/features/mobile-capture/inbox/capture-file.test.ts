// Graphium ネイティブ捕獲ファイル（メモ / URL の JSON）のテスト。
// 対象の不変条件:
// - build → parse がラウンドトリップする（モバイルで作りデスクトップで読む契約）
// - 判定は **拡張子 + JSON 形状の両方**。どちらかを満たさなければ null
//   （ユーザーが手で置いた無関係な .json を乗っ取らない / 未知バージョンは素材扱いに退避）
// - createdAt 欠落は弾かない（着地側の時刻で補う — データを落とさない）
// - captureKindFromName は正規化名（-memo / -url サフィックス）と元名の両方で kind を返す

import { describe, it, expect } from "vitest";
import {
  GRAPHIUM_CAPTURE_EXTENSION,
  GRAPHIUM_CAPTURE_MIME,
  buildMemoCaptureFile,
  buildUrlCaptureFile,
  captureFilePreview,
  captureKindFromName,
  isGraphiumCaptureName,
  parseGraphiumCaptureFile,
} from "./capture-file";

describe("buildMemoCaptureFile / buildUrlCaptureFile", () => {
  it("builds a memo capture file that parses back to the same payload", async () => {
    const when = new Date("2026-07-27T15:30:00.000Z");
    const file = buildMemoCaptureFile("thought of the day\nsecond line", when);

    expect(file.name).toBe(`memo${GRAPHIUM_CAPTURE_EXTENSION}`);
    expect(file.type).toBe(GRAPHIUM_CAPTURE_MIME);

    const payload = parseGraphiumCaptureFile(file.name, await file.text());
    expect(payload).toEqual({
      graphium: 1,
      kind: "memo",
      createdAt: "2026-07-27T15:30:00.000Z",
      text: "thought of the day\nsecond line",
    });
  });

  it("builds a url capture file carrying the metadata fetched on the phone", async () => {
    const when = new Date("2026-07-27T15:31:00.000Z");
    const file = buildUrlCaptureFile(
      {
        url: "https://example.com/article",
        title: "An Article",
        description: "What it says",
        ogImage: "https://example.com/og.png",
      },
      when,
    );

    expect(file.name).toBe(`url${GRAPHIUM_CAPTURE_EXTENSION}`);
    const payload = parseGraphiumCaptureFile(file.name, await file.text());
    expect(payload).toEqual({
      graphium: 1,
      kind: "url",
      createdAt: "2026-07-27T15:31:00.000Z",
      url: "https://example.com/article",
      title: "An Article",
      description: "What it says",
      ogImage: "https://example.com/og.png",
    });
  });

  it("omits empty optional url fields instead of writing blanks", async () => {
    const file = buildUrlCaptureFile({ url: "https://example.com", title: "  " });
    const payload = parseGraphiumCaptureFile(file.name, await file.text());
    expect(payload).toMatchObject({ kind: "url", url: "https://example.com" });
    expect(payload && "title" in payload ? payload.title : undefined).toBeUndefined();
  });
});

describe("parseGraphiumCaptureFile", () => {
  const memoJson = JSON.stringify({
    graphium: 1,
    kind: "memo",
    createdAt: "2026-07-27T00:00:00.000Z",
    text: "hello",
  });

  it("requires the dedicated extension (a plain .json is never hijacked)", () => {
    expect(parseGraphiumCaptureFile("notes.json", memoJson)).toBeNull();
    expect(parseGraphiumCaptureFile("memo.txt", memoJson)).toBeNull();
    // 専用拡張子なら大文字混じりでも読む
    expect(
      parseGraphiumCaptureFile("GRAPHIUM-20260727-153000-01-MEMO.Graphium.JSON", memoJson),
    ).not.toBeNull();
  });

  it("rejects invalid JSON and non-object payloads", () => {
    expect(parseGraphiumCaptureFile("memo.graphium.json", "not json")).toBeNull();
    expect(parseGraphiumCaptureFile("memo.graphium.json", '"a string"')).toBeNull();
    expect(parseGraphiumCaptureFile("memo.graphium.json", "[1,2]")).toBeNull();
  });

  it("rejects unknown versions and kinds (falls back to plain asset import)", () => {
    expect(
      parseGraphiumCaptureFile(
        "memo.graphium.json",
        JSON.stringify({ graphium: 2, kind: "memo", text: "hello" }),
      ),
    ).toBeNull();
    expect(
      parseGraphiumCaptureFile(
        "memo.graphium.json",
        JSON.stringify({ graphium: 1, kind: "voice", text: "hello" }),
      ),
    ).toBeNull();
  });

  it("rejects payloads missing their required content field", () => {
    expect(
      parseGraphiumCaptureFile(
        "memo.graphium.json",
        JSON.stringify({ graphium: 1, kind: "memo" }),
      ),
    ).toBeNull();
    expect(
      parseGraphiumCaptureFile(
        "memo.graphium.json",
        JSON.stringify({ graphium: 1, kind: "memo", text: "   " }),
      ),
    ).toBeNull();
    expect(
      parseGraphiumCaptureFile(
        "url.graphium.json",
        JSON.stringify({ graphium: 1, kind: "url", title: "no url" }),
      ),
    ).toBeNull();
  });

  it("tolerates a missing createdAt by substituting the current time", () => {
    const payload = parseGraphiumCaptureFile(
      "memo.graphium.json",
      JSON.stringify({ graphium: 1, kind: "memo", text: "hello" }),
    );
    expect(payload?.kind).toBe("memo");
    expect(typeof payload?.createdAt).toBe("string");
    expect(payload?.createdAt.length).toBeGreaterThan(0);
  });

  it("drops non-string optional url fields instead of failing", () => {
    const payload = parseGraphiumCaptureFile(
      "url.graphium.json",
      JSON.stringify({ graphium: 1, kind: "url", url: "https://x.test", title: 42 }),
    );
    expect(payload).toMatchObject({ kind: "url", url: "https://x.test" });
    expect(payload && "title" in payload ? payload.title : undefined).toBeUndefined();
  });
});

describe("isGraphiumCaptureName / captureKindFromName", () => {
  it("detects the dedicated extension case-insensitively", () => {
    expect(isGraphiumCaptureName("memo.graphium.json")).toBe(true);
    expect(isGraphiumCaptureName("graphium-20260727-153000-01-memo.graphium.json")).toBe(true);
    expect(isGraphiumCaptureName("MEMO.GRAPHIUM.JSON")).toBe(true);
    expect(isGraphiumCaptureName("memo.json")).toBe(false);
    expect(isGraphiumCaptureName("graphium.json.jpg")).toBe(false);
  });

  it("derives the kind from raw and normalized names", () => {
    expect(captureKindFromName("memo.graphium.json")).toBe("memo");
    expect(captureKindFromName("url.graphium.json")).toBe("url");
    expect(captureKindFromName("graphium-20260727-153000-01-memo.graphium.json")).toBe("memo");
    expect(captureKindFromName("graphium-20260727-153000-02-url.graphium.json")).toBe("url");
    // kind が読めない捕獲名・捕獲でない名前は null
    expect(captureKindFromName("graphium-20260727-153000-03-something.graphium.json")).toBeNull();
    expect(captureKindFromName("IMG_1234.jpg")).toBeNull();
  });
});

describe("captureFilePreview", () => {
  it("uses the first non-empty memo line", () => {
    expect(
      captureFilePreview({
        graphium: 1,
        kind: "memo",
        createdAt: "2026-07-27T00:00:00.000Z",
        text: "\n  \nfirst real line\nrest",
      }),
    ).toBe("first real line");
  });

  it("prefers the url title and falls back to the url itself", () => {
    expect(
      captureFilePreview({
        graphium: 1,
        kind: "url",
        createdAt: "2026-07-27T00:00:00.000Z",
        url: "https://example.com/a",
        title: "Example",
      }),
    ).toBe("Example");
    expect(
      captureFilePreview({
        graphium: 1,
        kind: "url",
        createdAt: "2026-07-27T00:00:00.000Z",
        url: "https://example.com/a",
      }),
    ).toBe("https://example.com/a");
  });
});

// ── 送り先フォルダの往復 ──
// モバイルで選んだフォルダは、生のメディアと違って名前ではなく JSON の中を通る
// （normalizeCaptureName は .graphium.json を別分岐で正規化するので、名前に埋めても届かない）。
// 書き手と読み手が揃っていないと、届いた側は未分類のままになる。

describe("捕獲ファイルのフォルダ", () => {
  it("メモのフォルダが往復する", async () => {
    const file = buildMemoCaptureFile("こんにちは", new Date("2026-09-05T01:00:00Z"), "材料X");
    const parsed = parseGraphiumCaptureFile(file.name, await file.text());
    expect(parsed).toMatchObject({ kind: "memo", text: "こんにちは", folder: "材料X" });
  });

  it("URL のフォルダが往復する", async () => {
    const file = buildUrlCaptureFile(
      { url: "https://example.com", title: "例", folder: "実験B/一次" },
      new Date("2026-09-05T01:00:00Z"),
    );
    const parsed = parseGraphiumCaptureFile(file.name, await file.text());
    expect(parsed).toMatchObject({ kind: "url", folder: "実験B/一次" });
  });

  it("フォルダ未指定なら欄ごと出さない（旧バージョンのファイルもそのまま読める）", async () => {
    const memo = buildMemoCaptureFile("素の記録");
    const payload = JSON.parse(await memo.text());
    expect(payload).not.toHaveProperty("folder");
    expect(parseGraphiumCaptureFile(memo.name, await memo.text())).not.toHaveProperty("folder");
  });

  it("空白だけのフォルダは無指定として扱う", async () => {
    const file = buildMemoCaptureFile("記録", new Date(), "   ");
    expect(JSON.parse(await file.text())).not.toHaveProperty("folder");
  });

  it("前後の空白は落として運ぶ", async () => {
    const file = buildMemoCaptureFile("記録", new Date(), "  材料X  ");
    const parsed = parseGraphiumCaptureFile(file.name, await file.text());
    expect(parsed).toMatchObject({ folder: "材料X" });
  });
});
