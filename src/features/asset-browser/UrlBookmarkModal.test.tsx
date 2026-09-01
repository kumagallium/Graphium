// @vitest-environment jsdom
// URL ブックマーク登録モーダルの「メタデータと URL がずれない」テスト
//
// 対象の不変条件:
// - 登録されるエントリのタイトル・ドメイン・favicon は、必ず入力欄にある URL の
//   ものである。URL を書き換えてから自動取得（300ms デバウンス）が走るまでの間に
//   登録を押しても、前のサイトのメタデータは一切混ざらない。
//   favicon URL は保存後そのまま画像リクエストになるため、混ざると「ユーザーが
//   ブックマークしていないホストを叩く」ことになり、第三者 favicon サービスを
//   やめた意味が無くなる。
// - メタデータ無しの登録（プレビューを待たずに押す）は正常系として通り、
//   ドメインだけのエントリが正しく作られる。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { UrlBookmarkModal, metaForUrl } from "./UrlBookmarkModal";
import { LocaleProvider } from "../../i18n";
import type { MediaIndexEntry } from "./media-index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const URL_A = "https://a.example/x";
const URL_B = "https://b.example/y";

/** タイトルと宣言 favicon を持つ最小の HTML */
const pageHtml = (title: string, iconPath: string) =>
  `<!doctype html><html><head><title>${title}</title>` +
  `<link rel="icon" href="${iconPath}"></head><body></body></html>`;

const PAGES: Record<string, string> = {
  [URL_A]: pageHtml("A サイトの記事", "/a-icon.png"),
  [URL_B]: pageHtml("B サイトの記事", "/b-icon.png"),
};

beforeEach(() => {
  // ロケール依存でボタン文言が変わらないように固定する
  localStorage.setItem("graphium_locale", "en");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => ({
      ok: PAGES[input] !== undefined,
      text: async () => PAGES[input] ?? "",
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function setup() {
  const onRegister = vi.fn<(entry: MediaIndexEntry) => void>();
  const view = render(
    <LocaleProvider>
      <UrlBookmarkModal onRegister={onRegister} onClose={() => {}} />
    </LocaleProvider>,
  );
  const input = view.getByPlaceholderText("https://example.com/article");
  const registerButton = view.getByText("Register");
  const typeUrl = (value: string) => fireEvent.change(input, { target: { value } });
  /** プレビュー（タイトル入力欄）に指定タイトルが出るまで待つ */
  const waitForPreview = (title: string) =>
    waitFor(() => view.getByDisplayValue(title), { timeout: 3000 });
  return { view, onRegister, typeUrl, registerButton, waitForPreview };
}

describe("UrlBookmarkModal: 登録エントリと URL の一致", () => {
  it("プレビュー取得後に URL を書き換えて即登録しても、前のサイトのメタデータは混ざらない", async () => {
    const { onRegister, typeUrl, registerButton, waitForPreview } = setup();

    // A を入力してプレビューが出るまで待つ
    typeUrl(URL_A);
    await waitForPreview("A サイトの記事");

    // B に書き換え、デバウンス（300ms）が走る前に登録を押す
    typeUrl(URL_B);
    fireEvent.click(registerButton);

    expect(onRegister).toHaveBeenCalledTimes(1);
    const entry = onRegister.mock.calls[0][0];
    expect(entry.url).toBe(URL_B);
    // A のタイトル・ドメイン・favicon が 1 つも残っていないこと
    expect(entry.name).toBe("b.example");
    expect(entry.urlMeta?.domain).toBe("b.example");
    expect(entry.urlMeta?.faviconUrl).toBeUndefined();
    expect(entry.thumbnailUrl).toBe("https://b.example/favicon.ico");
    expect(JSON.stringify(entry)).not.toContain("a.example");
  });

  it("URL を書き換えると前のサイトのプレビューは消える", async () => {
    const { view, typeUrl, waitForPreview } = setup();

    typeUrl(URL_A);
    await waitForPreview("A サイトの記事");

    typeUrl(URL_B);
    expect(view.queryByDisplayValue("A サイトの記事")).toBeNull();
  });

  it("プレビューを待たずに登録しても、ドメインだけのエントリが正しく作られる", () => {
    const { onRegister, typeUrl, registerButton } = setup();

    typeUrl(URL_A);
    fireEvent.click(registerButton);

    expect(onRegister).toHaveBeenCalledTimes(1);
    const entry = onRegister.mock.calls[0][0];
    expect(entry.url).toBe(URL_A);
    expect(entry.name).toBe("a.example");
    expect(entry.urlMeta?.domain).toBe("a.example");
    expect(entry.urlMeta?.description).toBeUndefined();
    // 宣言アイコンは判らないので慣習的な favicon.ico に落ちる
    expect(entry.thumbnailUrl).toBe("https://a.example/favicon.ico");
  });

  it("プレビューを待ってから登録すれば、そのサイトのメタデータが載る", async () => {
    const { onRegister, typeUrl, registerButton, waitForPreview } = setup();

    typeUrl(URL_B);
    await waitForPreview("B サイトの記事");
    fireEvent.click(registerButton);

    const entry = onRegister.mock.calls[0][0];
    expect(entry.url).toBe(URL_B);
    expect(entry.name).toBe("B サイトの記事");
    expect(entry.urlMeta?.faviconUrl).toBe("https://b.example/b-icon.png");
    expect(entry.thumbnailUrl).toBe("https://b.example/b-icon.png");
  });

  it("元の URL に戻せばプレビューもメタデータも復帰する", async () => {
    const { onRegister, typeUrl, registerButton, waitForPreview } = setup();

    typeUrl(URL_A);
    await waitForPreview("A サイトの記事");
    typeUrl(URL_B);
    typeUrl(URL_A);
    fireEvent.click(registerButton);

    const entry = onRegister.mock.calls[0][0];
    expect(entry.url).toBe(URL_A);
    expect(entry.name).toBe("A サイトの記事");
    expect(entry.urlMeta?.faviconUrl).toBe("https://a.example/a-icon.png");
  });
});

describe("metaForUrl", () => {
  const meta = {
    url: URL_A,
    title: "A サイトの記事",
    description: "",
    domain: "a.example",
    faviconUrl: "https://a.example/a-icon.png",
  };

  it("取得元 URL と一致すれば返す（前後の空白は無視）", () => {
    expect(metaForUrl(meta, URL_A)).toBe(meta);
    expect(metaForUrl(meta, `  ${URL_A}  `)).toBe(meta);
  });

  it("取得元が違えば null（別サイトの値を読ませない）", () => {
    expect(metaForUrl(meta, URL_B)).toBeNull();
    expect(metaForUrl(meta, "")).toBeNull();
    expect(metaForUrl(null, URL_A)).toBeNull();
  });
});
