// ローカル参照の許可リストの表
//
// この判定 1 つで「ノートを開いた時点で外へ出るか」が決まる。許可リスト方式
// （deny by default）なので、緩めるほうへ間違えると即座に漏れになる。
// 特に、スキームだけを見て http(s) を弾く実装に書き換えられていないかを見る:
// `//host/x.png` や `x.png` はページ基準で解決されて外へ出る。

import { describe, it, expect } from "vitest";
import { isLocalMediaRef, isRemoteMediaRef, remoteRefHost } from "./local-media-ref";

describe("isLocalMediaRef", () => {
  const local = [
    "file-media://5f2c",
    "local-media://5f2c",
    "media-server://5f2c",
    "media://5f2c",
    "shared-blob:sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "blob:http://localhost:5173/2a1c-8f",
    "data:image/png;base64,iVBORw0KGgo=",
    "data:video/mp4;base64,AAAA",
    "data:audio/mpeg;base64,AAAA",
    // preview-image.ts のローカルキャッシュ参照（キーは英数と _- のみ）
    "media-text:preview_a1b2c3",
    // スキームは大文字小文字を区別しない
    "LOCAL-MEDIA://5f2c",
  ];
  it.each(local)("%s はローカル", (url) => {
    expect(isLocalMediaRef(url)).toBe(true);
    expect(isRemoteMediaRef(url)).toBe(false);
  });

  const remote = [
    "https://tracker.example/pixel.png",
    "http://tracker.example/pixel.png",
    "HTTPS://tracker.example/pixel.png",
    // 前後の空白は <img src> も new URL() も無視するので、こちらも落としてから見る
    "  https://tracker.example/pixel.png  ",
    // プロトコル相対・相対パスはページ基準で解決されて外へ出る
    "//tracker.example/pixel.png",
    "pixel.png",
    "/assets/pixel.png",
    "../pixel.png",
    // 画像以外の data: は <img> 経由で外部を読み得るので許可リストに入れない
    "data:text/html;base64,PHNjcmlwdD4=",
    "javascript:alert(1)",
    "ftp://tracker.example/pixel.png",
    // media-text: は形式まで見る（接頭辞を名乗るだけの値は通さない）
    "media-text:https://tracker.example/pixel.png",
    "media-text:preview_",
  ];
  it.each(remote)("%s はローカルでない", (url) => {
    expect(isLocalMediaRef(url)).toBe(false);
    expect(isRemoteMediaRef(url)).toBe(true);
  });

  it("空・未設定は「参照が無い」（remote でもある扱いにしない）", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(isLocalMediaRef(v)).toBe(false);
      expect(isRemoteMediaRef(v)).toBe(false);
    }
  });

  it("文字列以外を渡してもローカル扱いにしない", () => {
    for (const v of [0, {}, [], true] as unknown[]) {
      expect(isLocalMediaRef(v as string)).toBe(false);
    }
  });
});

describe("remoteRefHost", () => {
  it("ホスト名だけを返す（パス・クエリは出さない）", () => {
    expect(remoteRefHost("https://tracker.example/pixel/abc123.png?u=42")).toBe("tracker.example");
    expect(remoteRefHost("  https://tracker.example:8443/x  ")).toBe("tracker.example");
  });

  it("URL として読めない文字列は空文字", () => {
    expect(remoteRefHost("//tracker.example/x.png")).toBe("");
    expect(remoteRefHost("pixel.png")).toBe("");
  });
});
