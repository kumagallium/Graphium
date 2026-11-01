// 素材一覧のメモの件数（countMemosByAsset）のテスト。
//
// 対象の不変条件:
// - 件数は素材の「メモ」タブと同じ集合（filterMemosByAsset）の大きさ。
//   fileId 一致・本文の出典ラベル「— 素材名」・アーカイブ／ゴミ箱の除外・名前の長短を、
//   filterMemosByAsset と突き合わせて確かめる
// - 同じメモが fileId 一致と出典ラベルの両方に当たっても 1 件
// - 0 件の素材はキーを持たない。captureIndex / media が無ければ空

import { describe, it, expect } from "vitest";
import { countMemosByAsset } from "./asset-memo-counts";
import { filterMemosByAsset } from "./AssetMemosSection";
import type { CaptureEntry, CaptureIndex } from "../mobile-capture";
import type { MediaIndexEntry } from "./media-index";

function media(fileId: string, name: string): MediaIndexEntry {
  return {
    fileId,
    name,
    type: "image",
    mimeType: "image/png",
    url: "",
    thumbnailUrl: "",
    uploadedAt: "2026-10-30T00:00:00.000Z",
    usedIn: [],
  };
}

function cap(id: string, text: string, extra: Partial<CaptureEntry> = {}): CaptureEntry {
  return { id, text, createdAt: `2026-10-30T10:00:${id.padStart(2, "0")}.000Z`, ...extra };
}

function index(...captures: CaptureEntry[]): CaptureIndex {
  return { version: 1, updatedAt: "2026-10-30T00:00:00.000Z", captures };
}

describe("countMemosByAsset", () => {
  const MEDIA = [
    media("a", "sem-900c.png"),
    media("b", "x.png"),
    media("c", "とても長い名前のファイル_2026_10_30_最終版.pdf"),
    media("d", "sem"),
    media("e", ""),
  ];

  const CAPTURES = [
    cap("1", "メモ", { sourceAsset: { fileId: "a", type: "image" } }),
    cap("2", "引用\n\n— sem-900c.png"),
    // fileId 一致と出典ラベルの両方（a に 1 回だけ数える）
    cap("3", "両方\n\n— sem-900c.png", { sourceAsset: { fileId: "a", type: "image" } }),
    cap("4", "短い名前\n\n— x.png"),
    cap("5", "長い名前\n\n— とても長い名前のファイル_2026_10_30_最終版.pdf（p.3）"),
    // 名前の先頭が同じ別の素材（"sem" は "sem-900c.png" の接頭辞）。「— sem-900c.png」は sem にも当たる
    cap("6", "接頭辞\n\n— sem-900c.png"),
    // アーカイブ・ゴミ箱は数えない
    cap("7", "古い", { sourceAsset: { fileId: "a", type: "image" }, archivedAt: "2026-10-30T11:00:00.000Z" }),
    cap("8", "消した", { sourceAsset: { fileId: "b", type: "image" }, deletedAt: "2026-10-30T11:00:00.000Z" }),
    // 出典ラベルが文中にあっても当たる（includes）
    cap("9", "文中の — x.png を見た"),
    // 他の素材
    cap("10", "関係ない", { sourceAsset: { fileId: "zzz", type: "image" } }),
    // 区切りが半角ハイフンのものは出典ラベルではない
    cap("11", "- x.png"),
    cap("12", "ラベル無し"),
  ];

  it("素材ごとの件数が filterMemosByAsset の大きさと一致する", () => {
    const ci = index(...CAPTURES);
    const counts = countMemosByAsset(ci, MEDIA);
    for (const m of MEDIA) {
      expect(counts.get(m.fileId) ?? 0, `${m.fileId}(${m.name})`).toBe(filterMemosByAsset(ci, m).length);
    }
  });

  it("具体的な件数: fileId 一致と出典ラベルの重複は 1 件、アーカイブ／ゴミ箱は除く", () => {
    const counts = countMemosByAsset(index(...CAPTURES), MEDIA);
    // a: 1(fileId) + 2(label) + 3(両方=1) + 6(label) = 4
    expect(counts.get("a")).toBe(4);
    // b: 4 + 9（8 はゴミ箱）
    expect(counts.get("b")).toBe(2);
    expect(counts.get("c")).toBe(1);
    // d("sem"): 「— sem-900c.png」が 3 件（2, 3, 6）。「— sem」で始まるので当たる
    expect(counts.get("d")).toBe(3);
  });

  it("0 件の素材はキーを持たない", () => {
    const counts = countMemosByAsset(index(cap("1", "ラベル無し")), [media("a", "a.png")]);
    expect(counts.has("a")).toBe(false);
    expect(counts.size).toBe(0);
  });

  it("名前が空の素材は、出典ラベルの記号を含むメモすべてに当たる（filterMemosByAsset と同じ）", () => {
    const ci = index(cap("1", "— なにか"), cap("2", "記号なし"));
    const e = media("e", "");
    expect(countMemosByAsset(ci, [e]).get("e")).toBe(filterMemosByAsset(ci, e).length);
  });

  it("同じ fileId が複数あれば先頭の素材の名前で数える", () => {
    const ci = index(cap("1", "— first.png"), cap("2", "— second.png"));
    const counts = countMemosByAsset(ci, [media("a", "first.png"), media("a", "second.png")]);
    expect(counts.get("a")).toBe(1);
  });

  it("captureIndex / media が無ければ空", () => {
    expect(countMemosByAsset(null, MEDIA).size).toBe(0);
    expect(countMemosByAsset(undefined, MEDIA).size).toBe(0);
    expect(countMemosByAsset(index(cap("1", "x")), null).size).toBe(0);
    expect(countMemosByAsset(index(cap("1", "x")), []).size).toBe(0);
  });
});
