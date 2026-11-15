import { describe, expect, it } from "vitest";
import { selectInboxTranscribeTargets } from "./transcribe-targets";

const imp = (fileId: string, kind?: "memo" | "url") => ({ name: `${fileId}.x`, fileId, checksum: `c-${fileId}`, ...(kind ? { kind } : {}) });
const aud = (fileId: string, ocrText?: string) => ({ fileId, type: "audio" as const, mimeType: "audio/mp4", ...(ocrText ? { ocrText } : {}) });

describe("selectInboxTranscribeTargets", () => {
  it("文字が無い音声だけを選ぶ", () => {
    const media = [aud("a"), aud("b", "あり"), { fileId: "c", type: "image" as const, mimeType: "image/jpeg" }];
    expect(selectInboxTranscribeTargets([imp("a"), imp("b"), imp("c")], media)).toEqual(["a"]);
  });
  it("メモ・URL・索引に無いもの・索引なしは対象外、同じ fileId は 1 回", () => {
    expect(selectInboxTranscribeTargets([imp("a", "memo")], [aud("a")])).toEqual([]);
    expect(selectInboxTranscribeTargets([imp("z")], [aud("a")])).toEqual([]);
    expect(selectInboxTranscribeTargets([imp("a")], undefined)).toEqual([]);
    expect(selectInboxTranscribeTargets([imp("a"), imp("a")], [aud("a")])).toEqual(["a"]);
  });
});
