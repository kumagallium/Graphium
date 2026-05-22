// UrlReaderView の Storybook
// loading / ready / empty / error の 4 状態を切り替えて確認する。
//
// Reader 取得は実 API 呼び出しになるため、各 story では fetch を msw 不使用で
// 直接 stub し、状態だけを再現する（依存軽量化）。

import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { UrlReaderView } from "./UrlReaderView";
import type { MediaIndexEntry } from "./media-index";
import type { CitationSource } from "./SelectionPill";
import "../../app.css";

// ── モックエントリ ──
const ENTRY: MediaIndexEntry = {
  fileId: "url-1",
  name: "How Provenance Shapes Knowledge",
  type: "url",
  mimeType: "text/html",
  url: "https://example.com/article",
  thumbnailUrl: "",
  uploadedAt: new Date().toISOString(),
  usedIn: [],
  urlMeta: {
    domain: "example.com",
    description: "Provenance is not metadata. It is the substance of knowledge.",
  },
};

const READER_HTML = `
  <p>Provenance is not metadata. It is the substance of how knowledge is built up over time, paragraph by paragraph, decision by decision, from messy lab notes into stable theorems.</p>
  <p>If you cannot trace a claim back to the act that produced it, you do not have knowledge. You have folklore decorated with citations.</p>
  <h2>Three layers of labels</h2>
  <p>The rest of this piece walks through three layers of labels we have settled on after eighteen months of iteration in Graphium: <em>context</em> labels, <em>inline</em> labels, and <em>activity</em> labels. Each carries a different cost to the writer and a different yield in the reader.</p>
  <p>Progressive disclosure is the only way to make this tractable for human readers, who can hold maybe seven things in working memory at a time.</p>
`;

const READER_TEXT =
  "Provenance is not metadata. It is the substance of how knowledge is built up over time, paragraph by paragraph, decision by decision, from messy lab notes into stable theorems. If you cannot trace a claim back to the act that produced it, you do not have knowledge. You have folklore decorated with citations. Three layers of labels The rest of this piece walks through three layers of labels we have settled on after eighteen months of iteration in Graphium: context labels, inline labels, and activity labels. Each carries a different cost to the writer and a different yield in the reader. Progressive disclosure is the only way to make this tractable for human readers, who can hold maybe seven things in working memory at a time.";

type StubMode = "loading" | "ready" | "empty" | "error";

function FetchStub({ mode }: { mode: StubMode }) {
  // window.fetch を story 単位で差し替える（クリーンアップで戻す）
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const original = window.fetch;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.includes("/url/reader")) {
        return original(input, init);
      }
      if (mode === "loading") {
        return new Promise(() => {}); // 永久 pending
      }
      if (mode === "empty") {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "Readability extraction returned null" }), {
            status: 422,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (mode === "error") {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "Fetch failed: 500 Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      // ready
      return Promise.resolve(
        new Response(
          JSON.stringify({
            url: ENTRY.url,
            title: ENTRY.name,
            byline: "Jane Doe",
            siteName: "Example Blog",
            lang: "en",
            content: READER_HTML,
            textContent: READER_TEXT,
            excerpt: "Provenance is not metadata...",
            fetchedAt: new Date().toISOString(),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    };
    setArmed(true);
    return () => {
      window.fetch = original;
    };
  }, [mode]);

  if (!armed) return null;

  return (
    <div style={{ width: 720, height: 560, border: "1px solid var(--color-border)", display: "flex" }}>
      <UrlReaderView
        entry={ENTRY}
        onSaveSelectionAsMemo={(source: CitationSource) => {
          // Storybook ログ用
          // eslint-disable-next-line no-console
          console.log("[story] saveAsMemo", source);
          alert(`保存: ${source.selectionText.slice(0, 40)}…`);
        }}
      />
    </div>
  );
}

const meta: Meta<typeof FetchStub> = {
  title: "Asset Browser / UrlReaderView",
  component: FetchStub,
  parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof FetchStub>;

export const Loading: Story = { args: { mode: "loading" } };
export const Ready: Story = { args: { mode: "ready" } };
export const Empty: Story = { args: { mode: "empty" } };
export const ErrorState: Story = { args: { mode: "error" } };
