// mediaUrlForActiveProvider（fileId → プロバイダのスキームで URL を組み立てる）のテスト。
//
// ノートに書く素材 URL を 1 つのスキームに決め打ちすると、別プロバイダの環境で
// extractFileId が効かず画像がリンク切れになる（テーブルから出した画像が
// デスクトップで壊れた実例）。その環境の extractFileId が受け付ける形式を
// 検証して選ぶ、という不変条件を固定する。

import { describe, it, expect, afterEach } from "vitest";
import {
  registerProvider,
  setActiveProvider,
  mediaUrlForActiveProvider,
} from "./registry";

function fakeProvider(id: string, scheme: string) {
  return {
    id,
    extractFileId(url: string): string | null {
      const m = url.match(new RegExp(`^${scheme}://(.+)$`));
      return m ? m[1] : null;
    },
  } as any;
}

afterEach(() => {
  // 他テストへの影響を避ける（registry はモジュールシングルトン）。
  // initProviders が登録済みの local を active に戻す
  registerProvider(fakeProvider("local", "local-media"));
  setActiveProvider("local");
});

describe("mediaUrlForActiveProvider", () => {
  it.each([
    ["filesystem", "file-media"],
    ["local", "local-media"],
    ["server-fs", "media-server"],
  ])("%s プロバイダでは %s:// を選ぶ", (id, scheme) => {
    registerProvider(fakeProvider(id, scheme));
    setActiveProvider(id);
    expect(mediaUrlForActiveProvider("abc-123")).toBe(`${scheme}://abc-123`);
  });

  it("どの候補も受け付けないプロバイダでは media-server:// に倒す", () => {
    registerProvider(fakeProvider("weird", "unknown-scheme"));
    setActiveProvider("weird");
    expect(mediaUrlForActiveProvider("abc-123")).toBe("media-server://abc-123");
  });
});
