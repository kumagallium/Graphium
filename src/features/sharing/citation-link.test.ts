// 引用リンク（#shared/<uuid>）の生成とマッチングのテスト。
// buildSharedCitationLink が window.location を読むため jsdom で実行する。
// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import {
  buildSharedCitationLink,
  matchSharedCitationLink,
} from "./citation-link";

const ID = "0198c0de-1234-7000-8000-0123456789ab";

describe("buildSharedCitationLink", () => {
  it("ends with #shared/<id>", () => {
    expect(buildSharedCitationLink(ID)).toMatch(new RegExp(`#shared/${ID}$`));
  });
});

describe("matchSharedCitationLink", () => {
  it("extracts the id from a full link", () => {
    expect(matchSharedCitationLink(buildSharedCitationLink(ID))).toBe(ID);
  });

  it("extracts the id from a bare fragment", () => {
    expect(matchSharedCitationLink(`#shared/${ID}`)).toBe(ID);
  });

  it("rejects note links and unrelated text", () => {
    expect(matchSharedCitationLink(`https://x.test/app/#note/${ID}`)).toBeNull();
    expect(matchSharedCitationLink("hello world")).toBeNull();
    // 末尾に余計なパスが付くものは対象外（単体トークン規約）
    expect(matchSharedCitationLink(`#shared/${ID}/extra`)).toBeNull();
    // uuid 長でないものは対象外
    expect(matchSharedCitationLink("#shared/abc")).toBeNull();
  });
});
