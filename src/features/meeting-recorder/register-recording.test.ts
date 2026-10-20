// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const saved: { index: any } = { index: null };
vi.mock("../asset-browser/media-index", async () => {
  const actual = await vi.importActual<typeof import("../asset-browser/media-index")>("../asset-browser/media-index");
  return {
    ...actual,
    readMediaIndex: vi.fn(async () => actual.createEmptyIndex()),
    saveMediaIndex: vi.fn(async (i: unknown) => { saved.index = i; }),
  };
});

import { syncLocale } from "../../i18n";
import { buildRecordingEntries, registerRecording } from "./register-recording";

beforeEach(() => {
  syncLocale("ja");
  saved.index = null;
});

const base = { id: "r1", durationMs: 1000, droppedPackets: 0, tracks: { system: true, mic: true } };
const at = new Date(2026, 9, 19, 14, 5);

describe("buildRecordingEntries", () => {
  it("stereo WAV 1 件を audio/wav で作る", () => {
    const e = buildRecordingEntries({ ...base, fileId: "f1" }, at);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      fileId: "f1",
      type: "audio",
      mimeType: "audio/wav",
      url: "file-media://f1",
      name: "会議 2026-10-19 14:05.wav",
    });
  });

  it("fileId が null なら作らない（片方だけ録れた場合も fileId はある）", () => {
    expect(buildRecordingEntries({ ...base, fileId: null, tracks: { system: false, mic: false } }, at)).toHaveLength(0);
    expect(buildRecordingEntries({ ...base, fileId: "f1", tracks: { system: false, mic: true } }, at)).toHaveLength(1);
  });
});

describe("registerRecording", () => {
  it("索引に追加して保存し、変更を通知する", async () => {
    const onChanged = vi.fn();
    window.addEventListener("graphium:media-index-changed", onChanged);
    const n = await registerRecording({ ...base, fileId: "f1" }, at);
    window.removeEventListener("graphium:media-index-changed", onChanged);
    expect(n).toBe(1);
    expect(saved.index.media.map((m: any) => m.fileId)).toEqual(["f1"]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("fileId が null なら何も保存しない", async () => {
    expect(await registerRecording({ ...base, fileId: null, tracks: { system: false, mic: false } }, at)).toBe(0);
    expect(saved.index).toBeNull();
  });
});
