// @vitest-environment jsdom
// 共有フォルダをまたぐ引用の検出（§26 PR4）。
// - 共有先と違うフォルダにある引用だけを、フォルダごとに数える
// - 置き場所の分からない引用（一覧に無い）は数えない
// - 引用が無ければ聞かずに通す。あれば確認し、断れば共有しない

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSharedFolder, setSharedFolders } from "../../lib/storage/shared";
import { confirmCrossFolderCitations, crossFolderWarningText, findCrossFolderCitations } from "./cross-folder";

const ORG = "/Volumes/Org";
const TEAM = "/Volumes/TeamA";
const cite = (id: string) => ({ type: "sharedCitation", props: { sharedId: id } });
const doc = (...ids: string[]) => ({ pages: [{ blocks: [{ type: "paragraph", children: ids.map(cite) }] }] }) as never;
const t = (key: string, vars: Record<string, string> = {}) =>
  key + ":" + Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(",");

beforeEach(() => {
  localStorage.clear();
  setSharedFolders([createSharedFolder(ORG, "Whole org"), createSharedFolder(TEAM, "Team A")]);
});

describe("findCrossFolderCitations", () => {
  const entryRoots = { a: TEAM, b: TEAM, c: ORG };

  it("共有先と違うフォルダの引用だけを数える", () => {
    expect(findCrossFolderCitations(doc("a", "b", "c"), ORG, entryRoots, [ORG, TEAM])).toEqual([
      { root: TEAM, label: "Team A", count: 2 },
    ]);
  });

  it("同じフォルダへ共有するなら何も出さない", () => {
    expect(findCrossFolderCitations(doc("a", "b"), TEAM, entryRoots, [ORG, TEAM])).toEqual([]);
  });

  it("置き場所の分からない引用は数えない", () => {
    expect(findCrossFolderCitations(doc("zzz"), ORG, entryRoots, [ORG, TEAM])).toEqual([]);
  });
});

describe("confirmCrossFolderCitations", () => {
  it("引用が無ければ聞かずに通す", () => {
    const confirm = vi.fn();
    expect(confirmCrossFolderCitations([], ORG, t, confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("あれば共有先とフォルダ名を添えて聞き、断れば false", () => {
    const confirm = vi.fn(() => false);
    const cross = [{ root: TEAM, label: "Team A", count: 2 }];
    expect(confirmCrossFolderCitations(cross, ORG, t, confirm)).toBe(false);
    const message = crossFolderWarningText(cross, ORG, t);
    expect(confirm).toHaveBeenCalledWith(message);
    expect(message).toContain("target=Whole org");
    expect(message).toContain("name=Team A");
  });
});
