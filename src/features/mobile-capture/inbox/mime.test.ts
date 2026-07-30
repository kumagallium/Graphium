import { describe, it, expect } from "vitest";
import { mimeFromExtension, kindFromMime } from "./mime";

describe("mimeFromExtension", () => {
  it("maps common photo/video/audio extensions", () => {
    expect(mimeFromExtension("IMG_1234.jpg")).toBe("image/jpeg");
    expect(mimeFromExtension("photo.jpeg")).toBe("image/jpeg");
    expect(mimeFromExtension("shot.png")).toBe("image/png");
    expect(mimeFromExtension("clip.mov")).toBe("video/quicktime");
    expect(mimeFromExtension("movie.mp4")).toBe("video/mp4");
    expect(mimeFromExtension("voice.m4a")).toBe("audio/mp4");
    expect(mimeFromExtension("memo.caf")).toBe("audio/x-caf");
  });

  it("reads in-app recordings as audio, not as the video container they share", () => {
    // Chrome / Firefox の録音は WebM / Ogg で出るので、音声側は weba / oga に寄せる
    expect(mimeFromExtension("voice-20260730-090503.weba")).toBe("audio/webm");
    expect(mimeFromExtension("voice-20260730-090503.oga")).toBe("audio/ogg");
    expect(kindFromMime(mimeFromExtension("voice-20260730-090503.weba")!)).toBe("audio");
  });

  it("is case-insensitive on the extension (iPhone HEIC/MOV)", () => {
    expect(mimeFromExtension("IMG_0001.HEIC")).toBe("image/heic");
    expect(mimeFromExtension("VIDEO.MOV")).toBe("video/quicktime");
  });

  it("returns null for missing or unknown extension", () => {
    expect(mimeFromExtension("noextension")).toBeNull();
    expect(mimeFromExtension("trailingdot.")).toBeNull();
    expect(mimeFromExtension("archive.xyz")).toBeNull();
  });

  it("recognizes the compound .graphium.json capture extension, but not plain .json", () => {
    expect(mimeFromExtension("graphium-20260727-153000-01-memo.graphium.json")).toBe(
      "application/vnd.graphium.capture+json",
    );
    // 無関係な JSON は乗っ取らない（判定は importer 側でも拡張子 + 形状の両方）
    expect(mimeFromExtension("settings.json")).toBeNull();
  });
});

describe("kindFromMime", () => {
  it("derives capture kind from the mime top-level type", () => {
    expect(kindFromMime("image/png")).toBe("image");
    expect(kindFromMime("audio/mp4")).toBe("audio");
    expect(kindFromMime("video/quicktime")).toBe("video");
  });

  it("returns undefined for non-media mime (e.g. pdf)", () => {
    expect(kindFromMime("application/pdf")).toBeUndefined();
    expect(kindFromMime("text/plain")).toBeUndefined();
  });
});
