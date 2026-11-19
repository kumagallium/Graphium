import { describe, it, expect, vi } from "vitest";
import {
  buildDerivedCsvFile,
  buildDerivedSource,
  derivedFileName,
  keepDerivationFor,
  registerDerivedSource,
  reimportTargetOf,
} from "./derive";

const fromOptions = { headerRow: 3, endRow: 120, delimiter: "tab" as const, collapseConsecutive: false };

describe("derivedFileName", () => {
  it("拡張子を外して -filtered.csv を付ける", () => {
    expect(derivedFileName("oven-curves.csv")).toBe("oven-curves-filtered.csv");
    expect(derivedFileName("run.txt")).toBe("run-filtered.csv");
  });
  it("ドットが複数あっても最後の拡張子だけ外す", () => {
    expect(derivedFileName("a.b.c.dat")).toBe("a.b.c-filtered.csv");
  });
  it("拡張子が無い名前・日本語の名前", () => {
    expect(derivedFileName("noext")).toBe("noext-filtered.csv");
    expect(derivedFileName("焼成カーブ 2026.csv")).toBe("焼成カーブ 2026-filtered.csv");
  });
  it("すでに -filtered が付いていても重ねない", () => {
    expect(derivedFileName("oven-filtered.csv")).toBe("oven-filtered.csv");
    expect(derivedFileName("oven-filtered-filtered.csv")).toBe("oven-filtered.csv");
  });
  it("拡張子だけの名前は既定名", () => {
    expect(derivedFileName(".csv")).toBe("data-filtered.csv");
  });
});

describe("buildDerivedCsvFile", () => {
  it("見出しと行を CSV にして、名前と type を付ける", async () => {
    const r = buildDerivedCsvFile({ headers: ["a", "b"], rows: [["1", "x,y"]] }, "m.csv");
    expect(r.name).toBe("m-filtered.csv");
    expect(r.csv).toBe('a,b\n1,"x,y"');
    expect(r.file.name).toBe("m-filtered.csv");
    expect(r.file.type).toBe("text/csv");
  });
});

const extract = {
  spec: { columns: [], conditions: [{ column: "t", op: "ge" as const, value: "90" }] },
  result: { headers: ["t", "v"], rows: [["90", "1"], ["91", "2"]] },
  sourceRows: 120,
};

describe("buildDerivedSource", () => {
  const base = {
    derivedFileId: "copy1",
    derivedFileName: "m-filtered.csv",
    fromFileId: "orig1",
    fromFileName: "m.csv",
    fromOptions,
    extract,
    now: "2026-11-18T00:00:00.000Z",
  };
  it("写しを読む出所になり、読み方は固定（見出し 1 行・カンマ・行数 + 1）", () => {
    const s = buildDerivedSource(base);
    expect(s.fileName).toBe("m-filtered.csv");
    expect(s.fileId).toBe("copy1");
    expect(s.options).toEqual({ headerRow: 1, endRow: 3, delimiter: "comma", collapseConsecutive: false });
  });
  it("全列のとき columns は結果の見出し全部。行数と fromOptions を持つ", () => {
    const d = buildDerivedSource(base).derivation!;
    expect(d.kind).toBe("filter");
    expect(d.columns).toEqual(["t", "v"]);
    expect(d.sourceRows).toBe(120);
    expect(d.resultRows).toBe(2);
    expect(d.fromFileId).toBe("orig1");
    expect(d.fromFileName).toBe("m.csv");
    expect(d.fromOptions).toEqual(fromOptions);
    expect(d.conditions).toEqual(extract.spec.conditions);
  });
  it("列を選んだときはその列", () => {
    const d = buildDerivedSource({
      ...base,
      extract: { ...extract, spec: { columns: ["t"], conditions: [] }, result: { headers: ["t"], rows: [["1"]] } },
    }).derivation!;
    expect(d.columns).toEqual(["t"]);
  });
  it("前置きの測定条件を引き継ぐ", () => {
    expect(buildDerivedSource({ ...base, meta: [{ key: "k", value: "v" }] }).meta).toEqual([{ key: "k", value: "v" }]);
    expect(buildDerivedSource(base).meta).toBeUndefined();
  });
});

describe("registerDerivedSource", () => {
  it("元が素材なら写しだけ登録し、元を派生元に渡して本文を覚えさせる", async () => {
    const uploadAsset = vi.fn(async () => ({ fileId: "copy1" }));
    const primeAssetText = vi.fn();
    const s = await registerDerivedSource(
      { uploadAsset, primeAssetText },
      { file: { fileName: "m.csv", fileId: "orig1" }, fromOptions, extract }
    );
    expect(uploadAsset).toHaveBeenCalledTimes(1);
    expect((uploadAsset.mock.calls[0] as unknown[])[1]).toEqual({ derivedFromAssets: ["orig1"] });
    expect(primeAssetText).toHaveBeenCalledWith("copy1", "t,v\n90,1\n91,2");
    expect(s.derivation!.fromFileId).toBe("orig1");
  });
  it("元が未登録なら先に登録する", async () => {
    const uploadAsset = vi.fn(async (f: File) => ({ fileId: f.name === "m.csv" ? "orig9" : "copy9" }));
    const s = await registerDerivedSource(
      { uploadAsset, primeAssetText: vi.fn() },
      { file: { fileName: "m.csv", file: new File(["x"], "m.csv") }, fromOptions, extract }
    );
    expect(uploadAsset).toHaveBeenCalledTimes(2);
    expect(s.derivation!.fromFileId).toBe("orig9");
    expect(s.fileId).toBe("copy9");
  });
  it("リンクした素材が元なら、元は登録せず、大きさ・更新日時を来歴に残す", async () => {
    const uploadAsset = vi.fn(async () => ({ fileId: "copy2" }));
    const s = await registerDerivedSource(
      { uploadAsset, primeAssetText: vi.fn() },
      { file: { fileName: "m.csv", fileId: "link1", linked: { size: 10, mtimeMs: 20 } }, fromOptions, extract }
    );
    expect(uploadAsset).toHaveBeenCalledTimes(1); // 写しだけ
    expect(s.derivation).toMatchObject({ fromFileId: "link1", fromSize: 10, fromMtimeMs: 20 });
  });
  it("登録に失敗したら投げる", async () => {
    await expect(
      registerDerivedSource(
        { uploadAsset: vi.fn(async () => Promise.reject(new Error("x"))), primeAssetText: vi.fn() },
        { file: { fileName: "m.csv", fileId: "o" }, fromOptions, extract }
      )
    ).rejects.toThrow();
  });
});

describe("reimportTargetOf", () => {
  const derived = buildDerivedSource({
    derivedFileId: "c",
    derivedFileName: "m-filtered.csv",
    fromFileId: "orig1",
    fromFileName: "m.csv",
    fromOptions,
    extract,
  });
  it("元の素材・読み方・条件を返す", () => {
    const t = reimportTargetOf(derived)!;
    expect(t.fileId).toBe("orig1");
    expect(t.fileName).toBe("m.csv");
    expect(t.initialOptions).toEqual(fromOptions);
    expect(t.initialExtract.conditions).toEqual(extract.spec.conditions);
  });
  it("fromOptions が無い古い記録は initialOptions なし", () => {
    const old = { ...derived, derivation: { ...derived.derivation!, fromOptions: undefined } };
    expect(reimportTargetOf(old)!.initialOptions).toBeUndefined();
  });
  it("来歴が無い・元の ID が無いなら null", () => {
    expect(reimportTargetOf({ ...derived, derivation: undefined })).toBeNull();
    expect(reimportTargetOf({ ...derived, derivation: { ...derived.derivation!, fromFileId: undefined } })).toBeNull();
  });
});

describe("sourceColumns", () => {
  it("元の列の数を来歴に残す（無ければ項目ごと無い）", () => {
    const base = {
      derivedFileId: "c",
      derivedFileName: "m-filtered.csv",
      fromFileName: "m.csv",
      fromOptions,
    };
    expect(buildDerivedSource({ ...base, extract: { ...extract, sourceColumns: 2 } }).derivation!.sourceColumns).toBe(2);
    expect("sourceColumns" in buildDerivedSource({ ...base, extract }).derivation!).toBe(false);
  });
});

describe("keepDerivationFor", () => {
  const kept = buildDerivedSource({
    derivedFileId: "c",
    derivedFileName: "m-filtered.csv",
    fromFileName: "m.csv",
    fromOptions,
    extract,
  }).derivation!;
  const opened = { headerRow: 1, endRow: 3, delimiter: "comma" as const, collapseConsecutive: false };

  it("読み方が同じで絞り込みも無いときだけ残す", () => {
    expect(keepDerivationFor(kept, opened, { options: { ...opened } })).toBe(kept);
  });
  it("読み方を変えたら捨てる", () => {
    expect(keepDerivationFor(kept, opened, { options: { ...opened, endRow: 2 } })).toBeUndefined();
    expect(keepDerivationFor(kept, opened, { options: { ...opened, delimiter: "tab" } })).toBeUndefined();
  });
  it("絞り込みを入れたら捨てる", () => {
    expect(keepDerivationFor(kept, opened, { options: { ...opened }, extract: {} })).toBeUndefined();
  });
  it("来歴が無い・開いたときの読み方が分からないなら残さない", () => {
    expect(keepDerivationFor(undefined, opened, { options: opened })).toBeUndefined();
    expect(keepDerivationFor(kept, undefined, { options: opened })).toBeUndefined();
  });
});
