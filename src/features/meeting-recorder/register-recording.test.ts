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

const base = { id: "r1", durationMs: 1000, droppedPackets: 0 };
const at = new Date(2026, 9, 19, 14, 5);

describe("buildRecordingEntries", () => {
  it("相手 / 自分の 2 件を audio/wav で作る", () => {
    const e = buildRecordingEntries({ ...base, systemFileId: "s1", micFileId: "m1" }, at);
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({
      fileId: "s1",
      type: "audio",
      mimeType: "audio/wav",
      url: "file-media://s1",
      name: "会議 2026-10-19 14:05（相手）.wav",
    });
    expect(e[1]).toMatchObject({ fileId: "m1", url: "file-media://m1", name: "会議 2026-10-19 14:05（自分）.wav" });
  });

  it("片方が null なら 1 件だけ", () => {
    expect(buildRecordingEntries({ ...base, systemFileId: null, micFileId: "m1" }, at)).toHaveLength(1);
    expect(buildRecordingEntries({ ...base, systemFileId: null, micFileId: null }, at)).toHaveLength(0);
  });
});

describe("registerRecording", () => {
  it("索引に追加して保存し、変更を通知する", async () => {
    const onChanged = vi.fn();
    window.addEventListener("graphium:media-index-changed", onChanged);
    const n = await registerRecording({ ...base, systemFileId: "s1", micFileId: "m1" }, at);
    window.removeEventListener("graphium:media-index-changed", onChanged);
    expect(n).toBe(2);
    expect(saved.index.media.map((m: any) => m.fileId)).toEqual(["s1", "m1"]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("両方 null なら何も保存しない", async () => {
    expect(await registerRecording({ ...base, systemFileId: null, micFileId: null }, at)).toBe(0);
    expect(saved.index).toBeNull();
  });
});
