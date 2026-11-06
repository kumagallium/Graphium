// @vitest-environment jsdom
// 共有フォルダの一覧（§26）のテスト。
// 不変条件:
// - 旧形式（1 件だけのキー）は、一覧のキーが無いときに 1 件目として読める（読むだけで書かない）
// - 一覧を保存すると 1 件目が旧キーへ写る（古い版に戻しても既定の共有先が残る）
// - 大きなファイルの置き場と接続先は共有フォルダごと

import { describe, it, expect, beforeEach } from "vitest";
import {
  getSharedFolders,
  setSharedFolders,
  createSharedFolder,
  getSharedRoot,
  setSharedRoot,
  getBlobRoot,
  setBlobRoot,
  getSharedRootRemote,
  setSharedRootRemote,
  findSharedFolderByRoot,
  parseSharedFolders,
} from "./config";

beforeEach(() => {
  localStorage.clear();
});

describe("旧形式からの読み替え", () => {
  it("何も無ければ空", () => {
    expect(getSharedFolders()).toEqual([]);
    expect(getSharedRoot()).toBeNull();
  });

  it("旧キーの 1 件を既定の共有先として読む（置き場と接続先も）", () => {
    localStorage.setItem("graphium-shared-root", "/Volumes/Lab/Shared");
    localStorage.setItem("graphium-shared-blob-root", "/Volumes/Lab/Blobs");
    localStorage.setItem("graphium-shared-root-remote", "smb://nas/Lab");
    const [f, ...rest] = getSharedFolders();
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ root: "/Volumes/Lab/Shared", blobRoot: "/Volumes/Lab/Blobs", remote: "smb://nas/Lab" });
    expect(getSharedRoot()).toBe("/Volumes/Lab/Shared");
    expect(getBlobRoot()).toBe("/Volumes/Lab/Blobs");
    expect(getSharedRootRemote()).toBe("smb://nas/Lab");
  });

  it("読むだけでは一覧のキーを書かない", () => {
    localStorage.setItem("graphium-shared-root", "/a");
    getSharedFolders();
    expect(localStorage.getItem("graphium-shared-folders")).toBeNull();
  });

  it("読み替えた 1 件目の id は読むたびに同じ", () => {
    localStorage.setItem("graphium-shared-root", "/a");
    expect(getSharedFolders()[0].id).toBe(getSharedFolders()[0].id);
  });
});

describe("一覧の保存", () => {
  it("1 件目を旧キーへ写す", () => {
    const org = { ...createSharedFolder("/Volumes/Org", "組織全体"), blobRoot: "/Volumes/Org-blobs" };
    const deptA = createSharedFolder("/Volumes/DeptA", "部署 A");
    setSharedFolders([org, deptA]);
    expect(localStorage.getItem("graphium-shared-root")).toBe("/Volumes/Org");
    expect(localStorage.getItem("graphium-shared-blob-root")).toBe("/Volumes/Org-blobs");
    expect(getSharedFolders().map((f) => f.name)).toEqual(["組織全体", "部署 A"]);
  });

  it("並べ替えると既定の共有先が替わる", () => {
    const a = createSharedFolder("/a", "A");
    const b = createSharedFolder("/b", "B");
    setSharedFolders([a, b]);
    setSharedFolders([b, a]);
    expect(getSharedRoot()).toBe("/b");
    expect(localStorage.getItem("graphium-shared-root")).toBe("/b");
  });

  it("全部外すと旧キーも消える（古い版でも共有フォルダが残って見えない）", () => {
    setSharedFolders([createSharedFolder("/a")]);
    setSharedFolders([]);
    expect(getSharedFolders()).toEqual([]);
    expect(localStorage.getItem("graphium-shared-root")).toBeNull();
  });

  it("同じパスの二重登録は 1 件にまとめる", () => {
    setSharedFolders([createSharedFolder("/a", "1"), createSharedFolder("/a", "2")]);
    expect(getSharedFolders()).toHaveLength(1);
  });

  it("壊れた JSON は旧形式へ倒さず読めないものとして扱う", () => {
    expect(parseSharedFolders("{oops")).toBeNull();
    expect(parseSharedFolders("[{\"root\":\"\"},{\"name\":\"x\"}]")).toEqual([]);
  });
});

describe("共有フォルダごとの値", () => {
  beforeEach(() => {
    setSharedFolders([
      { ...createSharedFolder("/org", "組織全体"), blobRoot: "/org-blobs" },
      { ...createSharedFolder("/dept", "部署 A"), blobRoot: "/dept-blobs" },
    ]);
  });

  it("大きなファイルの置き場はフォルダごとに引ける", () => {
    expect(getBlobRoot()).toBe("/org-blobs");
    expect(getBlobRoot("/dept")).toBe("/dept-blobs");
    expect(getBlobRoot("/unknown")).toBeNull();
  });

  it("接続先はそのフォルダにだけ控える", () => {
    setSharedRootRemote("smb://nas/dept", "/dept");
    expect(getSharedRootRemote("/dept")).toBe("smb://nas/dept");
    expect(getSharedRootRemote("/org")).toBeNull();
  });

  it("setBlobRoot は既定の共有先だけを書き換える", () => {
    setBlobRoot("/org-blobs-2");
    expect(getBlobRoot("/org")).toBe("/org-blobs-2");
    expect(getBlobRoot("/dept")).toBe("/dept-blobs");
  });

  it("setSharedRoot は既定の共有先のパスを替え、他は残す", () => {
    setSharedRoot("/org2");
    expect(getSharedFolders().map((f) => f.root)).toEqual(["/org2", "/dept"]);
    expect(findSharedFolderByRoot("/org2")?.name).toBe("組織全体");
  });

  it("setSharedRoot(null) は既定の共有先だけを外し、次が既定になる", () => {
    setSharedRoot(null);
    expect(getSharedRoot()).toBe("/dept");
  });
});

describe("1 件も無いところから", () => {
  it("先に置き場だけ選んでも、共有フォルダを選べば引き継ぐ", () => {
    setBlobRoot("/blobs");
    setSharedRoot("/shared");
    expect(getBlobRoot()).toBe("/blobs");
  });
});
