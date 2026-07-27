// モバイル → Inbox 送出（Web Share API Level 2、送信キューのフォールバック）のテスト。
//
// 対象の不変条件:
// - ファイルは**渡された名前のまま** share に渡す（命名は push/naming.ts / enqueue 側の責務）
// - 複数ファイルを 1 回の share で渡し、data には files 以外を混ぜない
// - 共有シートを閉じただけ（AbortError）はエラー扱いしない
// - canShare が false / navigator.share 不在なら unsupported として分岐する
// - user gesture: share() は最初の await より前に呼ばれる

import { describe, it, expect, vi } from "vitest";
import {
  canShareFilesToInbox,
  shareFilesToInbox,
  type ShareCapableNavigator,
} from "./share-to-inbox";

function makeFile(name: string, type: string) {
  return new File([new Uint8Array([1, 2, 3]) as BlobPart], name, { type });
}

describe("canShareFilesToInbox", () => {
  it("is false when the navigator has no share/canShare (desktop browsers)", () => {
    expect(canShareFilesToInbox({} as ShareCapableNavigator)).toBe(false);
    expect(canShareFilesToInbox({ share: vi.fn() } as ShareCapableNavigator)).toBe(false);
  });

  it("asks canShare with an actual file rather than sniffing the UA", () => {
    const canShare = vi.fn((_data: { files?: File[] }) => true);
    expect(canShareFilesToInbox({ share: vi.fn(), canShare })).toBe(true);
    const probe = canShare.mock.calls[0][0];
    expect(probe.files).toHaveLength(1);
    expect(probe.files?.[0].type).toBe("image/jpeg");
  });

  it("is false when canShare rejects files (share-links-only implementations)", () => {
    expect(canShareFilesToInbox({ share: vi.fn(), canShare: () => false })).toBe(false);
  });

  it("is false when canShare throws", () => {
    expect(
      canShareFilesToInbox({
        share: vi.fn(),
        canShare: () => {
          throw new Error("boom");
        },
      }),
    ).toBe(false);
  });
});

describe("shareFilesToInbox", () => {
  function makeNav(share: ShareCapableNavigator["share"]) {
    const canShare = vi.fn(() => true);
    return { navigator: { share, canShare } as ShareCapableNavigator, canShare };
  }

  it("hands every file to a single share() call under its given name", async () => {
    const share = vi.fn(async (_data: { files?: File[] }) => {});
    const { navigator: nav } = makeNav(share);
    // 送信キューが enqueue 時に正規化した名前をそのまま持ってくる想定
    const files = [
      makeFile("graphium-20260726-102030-01.jpg", "image/jpeg"),
      makeFile("graphium-20260726-102030-02.mov", "video/quicktime"),
    ];

    const outcome = await shareFilesToInbox(files, { navigator: nav });

    expect(outcome.status).toBe("shared");
    expect(share).toHaveBeenCalledTimes(1);
    const data = share.mock.calls[0][0];
    expect(data.files?.map((f) => f.name)).toEqual([
      "graphium-20260726-102030-01.jpg",
      "graphium-20260726-102030-02.mov",
    ]);
    // iOS はファイル共有に title/text/url を混ぜると取りこぼすことがあるので files だけを渡す
    expect(Object.keys(data)).toEqual(["files"]);
  });

  it("treats a dismissed share sheet (AbortError) as a cancel, not an error", async () => {
    const abort = new Error("Share canceled");
    abort.name = "AbortError";
    const { navigator: nav } = makeNav(vi.fn(async () => { throw abort; }));

    const outcome = await shareFilesToInbox([makeFile("a.jpg", "image/jpeg")], {
      navigator: nav,
    });

    expect(outcome).toEqual({ status: "cancelled" });
  });

  it("reports other share failures", async () => {
    const { navigator: nav } = makeNav(vi.fn(async () => { throw new Error("no permission"); }));

    const outcome = await shareFilesToInbox([makeFile("a.jpg", "image/jpeg")], {
      navigator: nav,
    });

    expect(outcome).toEqual({ status: "failed", error: "no permission" });
  });

  it("returns unsupported without calling share when canShare rejects the files", async () => {
    const share = vi.fn(async () => {});
    const nav = { share, canShare: () => false } as ShareCapableNavigator;

    const outcome = await shareFilesToInbox([makeFile("huge.mov", "video/quicktime")], {
      navigator: nav,
    });

    expect(outcome).toEqual({ status: "unsupported" });
    expect(share).not.toHaveBeenCalled();
  });

  it("returns unsupported when the environment has no share at all", async () => {
    const outcome = await shareFilesToInbox([makeFile("a.jpg", "image/jpeg")], {
      navigator: {} as ShareCapableNavigator,
    });
    expect(outcome).toEqual({ status: "unsupported" });
  });

  it("fails fast on an empty file list", async () => {
    const share = vi.fn(async () => {});
    const outcome = await shareFilesToInbox([], {
      navigator: { share, canShare: () => true },
    });
    expect(outcome).toEqual({ status: "failed", error: "no files" });
    expect(share).not.toHaveBeenCalled();
  });

  it("calls share() synchronously so the user gesture is not lost", () => {
    // await を挟んでから share を呼ぶと iOS では NotAllowedError になる。
    // shareFilesToInbox を呼んだ直後（await する前）に share が呼ばれていることを確かめる。
    const share = vi.fn(async () => {});
    const { navigator: nav } = makeNav(share);

    void shareFilesToInbox([makeFile("a.jpg", "image/jpeg")], { navigator: nav });

    expect(share).toHaveBeenCalledTimes(1);
  });
});
