// 名前正規化のテスト。
// 対象の不変条件:
// - 形式は graphium-<YYYYMMDD-HHmmss>-<連番>.<ext>（ローカル時刻・連番 2 桁ゼロ詰め）
// - 拡張子は MIME 優先。MIME 未知なら元名の拡張子、それも無ければ "bin"

import { describe, it, expect } from "vitest";
import {
  extensionForCapture,
  formatCaptureTimestamp,
  normalizeCaptureName,
} from "./naming";

describe("extensionForCapture", () => {
  it("prefers the MIME type over the original file name", () => {
    // iOS は image.jpg のような汎用名 + 正しい MIME を返す。名前より MIME を信じる。
    expect(extensionForCapture("image/jpeg", "image.png")).toBe("jpg");
    expect(extensionForCapture("video/quicktime", "clip.bin")).toBe("mov");
    expect(extensionForCapture("audio/mp4", "recording.txt")).toBe("m4a");
    expect(extensionForCapture("application/pdf", "doc")).toBe("pdf");
  });

  it("ignores MIME parameters like codecs", () => {
    expect(extensionForCapture("video/mp4;codecs=avc1", "x")).toBe("mp4");
    expect(extensionForCapture("Image/JPEG", "x")).toBe("jpg");
  });

  it("falls back to the original extension for unknown MIME types", () => {
    expect(extensionForCapture("application/x-unknown", "notes.docx")).toBe("docx");
    expect(extensionForCapture("", "photo.HEIC")).toBe("heic");
  });

  it("falls back to bin when neither MIME nor name give an extension", () => {
    expect(extensionForCapture("application/x-unknown", "noext")).toBe("bin");
    expect(extensionForCapture("", "trailingdot.")).toBe("bin");
    // 変な拡張子（長すぎ・記号入り）は採用しない
    expect(extensionForCapture("", "file.notarealextension")).toBe("bin");
    expect(extensionForCapture("", "file.j p")).toBe("bin");
  });
});

describe("formatCaptureTimestamp", () => {
  it("formats as YYYYMMDD-HHmmss in local time with zero padding", () => {
    // ローカル時刻コンストラクタなのでタイムゾーンに依存しない検証になる
    const d = new Date(2026, 0, 5, 9, 3, 7); // 2026-01-05 09:03:07 local
    expect(formatCaptureTimestamp(d)).toBe("20260105-090307");
  });
});

describe("normalizeCaptureName", () => {
  it("builds graphium-<stamp>-<seq>.<ext> with a zero-padded sequence", () => {
    const when = new Date(2026, 6, 26, 14, 30, 5);
    expect(
      normalizeCaptureName({ mime: "image/jpeg", originalName: "image.jpg", when, seq: 1 }),
    ).toBe("graphium-20260726-143005-01.jpg");
    expect(
      normalizeCaptureName({ mime: "video/quicktime", originalName: "clip.mov", when, seq: 12 }),
    ).toBe("graphium-20260726-143005-12.mov");
  });

  it("keeps sequences above 99 unpadded", () => {
    const when = new Date(2026, 6, 26, 14, 30, 5);
    expect(
      normalizeCaptureName({ mime: "image/png", originalName: "x.png", when, seq: 123 }),
    ).toBe("graphium-20260726-143005-123.png");
  });

  it("keeps the kind and the dedicated extension for graphium capture files", () => {
    // メモ / URL 捕獲（capture-file.ts）は kind を名前に残す専用形。
    // 受信側は名前だけでアイコンを出せ、.graphium.json が汎用 .json との誤爆を防ぐ。
    const when = new Date(2026, 6, 27, 15, 30, 0);
    expect(
      normalizeCaptureName({
        mime: "application/vnd.graphium.capture+json",
        originalName: "memo.graphium.json",
        when,
        seq: 1,
      }),
    ).toBe("graphium-20260727-153000-01-memo.graphium.json");
    expect(
      normalizeCaptureName({
        mime: "application/vnd.graphium.capture+json",
        originalName: "url.graphium.json",
        when,
        seq: 2,
      }),
    ).toBe("graphium-20260727-153000-02-url.graphium.json");
  });

  it("falls back to a generic capture kind when the original name has none", () => {
    const when = new Date(2026, 6, 27, 15, 30, 0);
    expect(
      normalizeCaptureName({
        mime: "application/vnd.graphium.capture+json",
        originalName: "weird.graphium.json",
        when,
        seq: 1,
      }),
    ).toBe("graphium-20260727-153000-01-capture.graphium.json");
  });
});
