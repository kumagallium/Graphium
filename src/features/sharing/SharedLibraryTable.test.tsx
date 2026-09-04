// @vitest-environment jsdom
// 共有ライブラリの表「フォルダ列」が、ノート一覧のフォルダ列と同じ見せ方になっているかのテスト。
//
// 対象の不変条件（鏡の原則 — 同じ意味のものは同じ見た目で出す）:
// - 列ヘッダにノート一覧と同じ説明ツールチップ（nav.noteContextsTooltip）が付く
// - フォルダ無しの行のダッシュは、ノート一覧と同じ薄さ（text-muted-foreground/30）
// - 絞り込みポップアップの選択肢に、表のピル（ContextBadge）と同じ色のドットが付く
//   （未分類は実在するフォルダではないので色を持たない = 中空のドット）

import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { SharedLibraryTable } from "./SharedLibraryTable";
import { LocaleProvider, t } from "../../i18n";
import { ContextBadge } from "../note-context/ContextBadge";
import type { SharedEntry } from "../../lib/storage/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AUTHOR = { name: "Ada", email: "ada@example.com" };

const entry = (id: string, title: string, noteContexts?: string[]): SharedEntry => ({
  id,
  type: "note",
  author: AUTHOR,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  hash: `sha256:${id}`,
  prov: { derived_from: [] },
  version: 1,
  extra: noteContexts ? { title, noteContexts } : { title },
});

const ENTRIES = [
  entry("n1", "焼結の記録", ["卒論/焼結"]),
  entry("n2", "装置メモ", ["共通/装置"]),
  entry("n3", "フォルダ無し"),
];

function renderTable() {
  return render(
    <LocaleProvider>
      <SharedLibraryTable
        tab="note"
        entries={ENTRIES}
        currentIdentity={AUTHOR}
        hashStatus={{}}
        selectedId={null}
        busyId={null}
        copiedId={null}
        onSelect={() => {}}
        onVerifyHash={() => {}}
        onCopyCitation={() => {}}
        onUnshare={() => {}}
      />
    </LocaleProvider>,
  );
}

/**
 * 表のピル（ContextBadge）が使う色。jsdom は inline style の hsl() を rgb() に
 * 変換するので、期待値も同じ経路（実際の ContextBadge を描画）から取って比べる。
 */
function badgeColor(value: string): string {
  const { container, unmount } = render(
    <LocaleProvider>
      <ContextBadge value={value} />
    </LocaleProvider>,
  );
  const color = (container.firstElementChild as HTMLElement).style.color;
  unmount();
  return color;
}

afterEach(() => cleanup());

describe("SharedLibraryTable のフォルダ列", () => {
  it("列ヘッダにノート一覧と同じ説明ツールチップが付く", () => {
    const { container } = renderTable();
    const headers = Array.from(container.querySelectorAll("th"));
    const folderTh = headers.find((th) => th.textContent?.includes(t("nav.noteContexts")));
    expect(folderTh?.getAttribute("title")).toBe(t("nav.noteContextsTooltip"));
  });

  it("フォルダ無しの行のダッシュはノート一覧と同じ薄さで出る", () => {
    const { container } = renderTable();
    const dash = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "—",
    );
    expect(dash?.className).toContain("text-muted-foreground/30");
  });

  it("絞り込みの選択肢に表のピルと同じ色のドットが付く（未分類は色無し）", () => {
    const { container } = renderTable();
    const filterBtn = container.querySelector(
      `button[aria-label="${t("library.filterFolder")}"]`,
    ) as HTMLButtonElement;
    fireEvent.click(filterBtn);

    // ポップアップは portal 経由で body 直下に出る
    const options = Array.from(
      document.body.querySelectorAll('button[role="menuitemcheckbox"]'),
    ) as HTMLElement[];
    for (const folder of ["卒論/焼結", "共通/装置"]) {
      const opt = options.find((o) => o.textContent?.includes(folder));
      const dot = opt?.querySelector("span.rounded-full") as HTMLElement | null;
      expect(dot, `${folder} のドット`).toBeTruthy();
      expect(dot?.style.backgroundColor).toBe(badgeColor(folder));
    }

    // 未分類の選択肢は色を持たず、境界線だけのドットになる
    const unfiled = options.find((o) => o.textContent?.includes(t("nav.unfiled")));
    expect(unfiled, "未分類の選択肢").toBeTruthy();
    const unfiledDot = unfiled?.querySelector("span.rounded-full") as HTMLElement | null;
    expect(unfiledDot?.style.backgroundColor).toBe("");
    expect(unfiledDot?.className).toContain("border-border");
  });
});

// ── 素材タブの blob 行（共有ノート内の画像・ファイル） ──
// SharedEntry ではない仮想行なので、版・検証は空欄・操作は「ノートを開く」と「取り込む」だけ。
// 検索 / 絞り込み / 並び替えは共有エントリの行と同じ経路で効く必要がある。

const assetEntry = (id: string, title: string, mediaType: string): SharedEntry => ({
  id,
  type: "data-manifest",
  author: AUTHOR,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-03T00:00:00Z",
  hash: `sha256:${id}`,
  prov: { derived_from: [] },
  version: 1,
  extra: { title, media_type: mediaType },
});

const blobRef = (hash: string, filename?: string) => ({
  provider: "local-folder",
  uri: `file:///blobs/${hash}`,
  hash,
  size: 10,
  ...(filename ? { filename } : {}),
});

/** 同じ画像を 2 ノートが持ち、片方だけが別の PDF も持つ構成 */
const BLOB_PARENTS: SharedEntry[] = [
  {
    ...entry("p1", "焼結ノート", ["卒論/焼結"]),
    extra: {
      title: "焼結ノート",
      noteContexts: ["卒論/焼結"],
      blobs: [blobRef("sha256:aaa", "spectrum.png"), blobRef("sha256:bbb", "paper.pdf")],
    },
  },
  {
    ...entry("p2", "装置ノート", ["共通/装置"]),
    extra: {
      title: "装置ノート",
      noteContexts: ["共通/装置"],
      blobs: [blobRef("sha256:aaa", "spectrum.png")],
    },
  },
];

function renderAssetTable(
  overrides: Partial<React.ComponentProps<typeof SharedLibraryTable>> = {},
) {
  return render(
    <LocaleProvider>
      <SharedLibraryTable
        tab="asset"
        entries={[assetEntry("a1", "測定データ", "data")]}
        currentIdentity={AUTHOR}
        hashStatus={{}}
        selectedId={null}
        busyId={null}
        copiedId={null}
        onSelect={() => {}}
        onVerifyHash={() => {}}
        onCopyCitation={() => {}}
        onUnshare={() => {}}
        blobParents={BLOB_PARENTS}
        {...overrides}
      />
    </LocaleProvider>,
  );
}

function rowTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("tbody tr")).map((tr) => tr.textContent ?? "");
}

describe("SharedLibraryTable の素材タブ（blob 行）", () => {
  it("同じ hash の blob は 1 行に集約され、出どころ列に件数が出る", () => {
    const { container } = renderAssetTable();
    const rows = rowTexts(container);
    // 共有エントリ 1 + blob 2 種（spectrum.png は 2 ノートで 1 行に畳まれる）
    expect(rows).toHaveLength(3);
    const spectrum = rows.find((r) => r.includes("spectrum.png"));
    expect(spectrum).toContain(t("library.blobOrigins", { count: "2" }));
    // 1 ノートだけの blob は、そのノートの題名が出どころになる
    expect(rows.find((r) => r.includes("paper.pdf"))).toContain("焼結ノート");
  });

  it("種別は拡張子から推定し、版・検証は空欄になる", () => {
    const { container } = renderAssetTable();
    const pdfRow = Array.from(container.querySelectorAll("tbody tr")).find((tr) =>
      tr.textContent?.includes("paper.pdf"),
    )!;
    const cells = Array.from(pdfRow.querySelectorAll("td")).map((td) => td.textContent);
    expect(cells).toContain(t("asset.type.pdf"));
    // 版（v1 など）は付かず、ダッシュのまま
    expect(pdfRow.textContent).not.toContain("v1");
  });

  it("素材タブでもフォルダ列が出て、blob 行は親ノートのフォルダを表示する", () => {
    const { container } = renderAssetTable();
    const headers = Array.from(container.querySelectorAll("th"));
    expect(headers.some((th) => th.textContent?.includes(t("nav.noteContexts")))).toBe(true);
    const spectrumRow = Array.from(container.querySelectorAll("tbody tr")).find((tr) =>
      tr.textContent?.includes("spectrum.png"),
    )!;
    expect(spectrumRow.textContent).toContain("卒論/焼結");
  });

  it("検索は blob 行にも効く", () => {
    const { container } = renderAssetTable();
    const search = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "spectrum" } });
    const rows = rowTexts(container);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("spectrum.png");
  });

  it("種別フィルタは blob 行にも効く", () => {
    const { container } = renderAssetTable();
    const filterBtn = container.querySelector(
      `button[aria-label="${t("library.filterKind")}"]`,
    ) as HTMLButtonElement;
    fireEvent.click(filterBtn);
    const options = Array.from(
      document.body.querySelectorAll('button[role="menuitemcheckbox"]'),
    ) as HTMLElement[];
    const pdfOption = options.find((o) => o.textContent?.includes(t("asset.type.pdf")))!;
    expect(pdfOption).toBeTruthy();
    fireEvent.click(pdfOption);
    const rows = rowTexts(container);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("paper.pdf");
  });

  it("取り込みは onImportBlob に親ノートと BlobRef を渡す", () => {
    const calls: { parent: string; hash: string }[] = [];
    const { container } = renderAssetTable({
      onImportBlob: async (parent, blob) => {
        calls.push({ parent: parent.id, hash: blob.hash });
      },
    });
    const spectrumRow = Array.from(container.querySelectorAll("tbody tr")).find((tr) =>
      tr.textContent?.includes("spectrum.png"),
    )!;
    const importBtn = spectrumRow.querySelector(
      `button[aria-label="${t("library.importBlob")}"]`,
    ) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(false);
    fireEvent.click(importBtn);
    expect(calls).toEqual([{ parent: "p1", hash: "sha256:aaa" }]);
  });

  it("blob root 未設定（onImportBlob 無し）なら取り込みは無効で理由を出す", () => {
    const { container } = renderAssetTable();
    const importBtn = container.querySelector(
      `button[aria-label="${t("library.importBlob")}"]`,
    ) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
    expect(importBtn.getAttribute("title")).toBe(t("share.noBlobRootPreview"));
  });

  it("blobParents が無ければ従来どおり共有エントリだけの表になる", () => {
    const { container } = renderAssetTable({ blobParents: undefined });
    expect(rowTexts(container)).toHaveLength(1);
    // 出どころ列は blob 行があるときだけ出す
    const headers = Array.from(container.querySelectorAll("th"));
    expect(headers.some((th) => th.textContent?.includes(t("library.col.origins")))).toBe(false);
  });
});

// ── テンプレートタブ ──
// テンプレートは「記録」ではなく雛形なので、ノートタブと出し分けが変わる:
// - 説明列が増える（題名だけでは何の雛形か分からない）
// - フォルダ列は出さない（共有した人の整理であって雛形の属性ではない）
// - 派生（fork）は出さない。新規ノートは詳細パネルの「テンプレートから新規ノート」から

const templateEntry = (
  id: string,
  title: string,
  description: string | null,
  author = AUTHOR,
): SharedEntry => ({
  id,
  type: "template",
  author,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-04T00:00:00Z",
  hash: `sha256:${id}`,
  prov: { derived_from: [] },
  version: 1,
  extra: { title, description, stepCount: 3, labelCount: 5, pageTitle: title },
});

const OTHER = { name: "Grace", email: "grace@example.com" };

const TEMPLATES = [
  templateEntry("t1", "焼結実験ノートの雛形", "秤量→成形→焼結の 3 手順が入っています"),
  templateEntry("t2", "前処理チェックリスト", null, OTHER),
];

function renderTemplateTable(
  overrides: Partial<React.ComponentProps<typeof SharedLibraryTable>> = {},
) {
  return render(
    <LocaleProvider>
      <SharedLibraryTable
        tab="template"
        entries={TEMPLATES}
        currentIdentity={AUTHOR}
        hashStatus={{}}
        selectedId={null}
        busyId={null}
        copiedId={null}
        onSelect={() => {}}
        onVerifyHash={() => {}}
        onCopyCitation={() => {}}
        onFork={() => {}}
        onUnshare={() => {}}
        {...overrides}
      />
    </LocaleProvider>,
  );
}

function rowByText(container: HTMLElement, text: string): HTMLElement {
  return Array.from(container.querySelectorAll("tbody tr")).find((tr) =>
    tr.textContent?.includes(text),
  ) as HTMLElement;
}

describe("SharedLibraryTable のテンプレートタブ", () => {
  it("列は タイトル / 説明 / 作者 / 共有日 / 版 / 検証（フォルダ・種別は出さない）", () => {
    const { container } = renderTemplateTable();
    const headers = Array.from(container.querySelectorAll("th")).map((th) => th.textContent ?? "");
    expect(headers.some((h) => h.includes(t("library.col.description")))).toBe(true);
    expect(headers.some((h) => h.includes(t("nav.noteContexts")))).toBe(false);
    expect(headers.some((h) => h.includes(t("library.col.kind")))).toBe(false);
    for (const key of ["library.col.title", "nav.author", "library.col.sharedAt", "library.col.version", "library.col.verified"]) {
      expect(headers.some((h) => h.includes(t(key))), key).toBe(true);
    }
  });

  it("説明は行に出て、説明の無い行はダッシュになる", () => {
    const { container } = renderTemplateTable();
    const withDesc = rowByText(container, "焼結実験ノートの雛形");
    expect(withDesc.textContent).toContain("秤量→成形→焼結の 3 手順が入っています");
    const withoutDesc = rowByText(container, "前処理チェックリスト");
    expect(withoutDesc.textContent).toContain("—");
  });

  it("検索は説明にも効く", () => {
    const { container } = renderTemplateTable();
    const search = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "秤量" } });
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("焼結実験ノートの雛形");
  });

  it("他人作でも派生（fork）は出さない。引用リンクのコピーは出る", () => {
    const { container } = renderTemplateTable();
    const othersRow = rowByText(container, "前処理チェックリスト");
    expect(othersRow.querySelector(`button[title="${t("library.forkToNotes")}"]`)).toBeNull();
    expect(othersRow.querySelector(`button[title="${t("share.copyCitation")}"]`)).toBeTruthy();
    // 他人作なので共有解除は出ない
    expect(othersRow.querySelector(`button[title="${t("library.unshare")}"]`)).toBeNull();
  });

  it("自分作の行にだけ共有解除が出る", () => {
    const { container } = renderTemplateTable();
    const mineRow = rowByText(container, "焼結実験ノートの雛形");
    expect(mineRow.querySelector(`button[title="${t("library.unshare")}"]`)).toBeTruthy();
  });
});
