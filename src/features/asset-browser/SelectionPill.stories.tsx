// SelectionPill / CitationBlockPreview / ComposerQuotedPreview の Storybook
// PDF / URL 内のテキスト選択 → 引用作成の UX を視覚化する

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  SelectionPill,
  CitationBlockPreview,
  ComposerQuotedPreview,
  type CitationSource,
} from "./SelectionPill";
import "../../app.css";

// ── モック引用元 ──
const PDF_SOURCE: CitationSource = {
  entry: {
    fileId: "mat-pdf",
    name: "Theory of Sintering by Kingery (1958).pdf",
    type: "pdf",
    url: "",
  },
  selectionText:
    "Sintering of copper powders proceeds via three distinct stages: initial neck formation, intermediate densification, and final pore elimination. The rate-limiting step shifts from surface diffusion to grain boundary diffusion as the temperature rises.",
  pageNumber: 7,
};

const URL_SOURCE: CitationSource = {
  entry: {
    fileId: "mat-url",
    name: "Materials Project — Cu phase diagram",
    type: "url",
    url: "https://materialsproject.org/materials/mp-30",
    urlMeta: {
      domain: "materialsproject.org",
    },
  },
  selectionText:
    "First-principles calculations predict a melting point of 1357 K for pure Cu, in good agreement with experimental values within 2%.",
  textFragment: "melting point of 1357 K",
};

const SHORT_SOURCE: CitationSource = {
  entry: {
    fileId: "mat-pdf",
    name: "Notes.pdf",
    type: "pdf",
    url: "",
  },
  selectionText: "焼結体の密度は 85% に到達した。",
  pageNumber: 3,
};

const meta: Meta = {
  title: "AssetBrowser/SelectionPill",
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div
        style={{
          minHeight: "100vh",
          padding: 24,
          background: "var(--color-background)",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj;

// ── 1. Pill 単体 ──
export const PillOnly: Story = {
  name: "Pill 単体（PDF 出典）",
  render: () => (
    <div style={{ display: "flex", gap: 24, flexDirection: "column", alignItems: "flex-start" }}>
      <SelectionPill
        source={PDF_SOURCE}
        onQuoteToNote={(s) => console.log("Quote to note:", s)}
        onQuoteToChat={(s) => console.log("Quote to chat:", s)}
        onDismiss={() => console.log("dismiss")}
      />
      <SelectionPill
        source={URL_SOURCE}
        onQuoteToNote={(s) => console.log("Quote to note:", s)}
        onQuoteToChat={(s) => console.log("Quote to chat:", s)}
      />
    </div>
  ),
};

// ── 2. PDF viewer 上に重ねた状態（モック） ──
export const OverPdfViewer: Story = {
  name: "PDF viewer 上にフロート",
  render: () => {
    const Demo = () => {
      const [pillVisible, setPillVisible] = useState(true);
      return (
        <div
          style={{
            position: "relative",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            overflow: "hidden",
            background: "#f5f5f0",
            padding: 32,
            minHeight: 480,
            color: "var(--ink-2)",
            lineHeight: 1.7,
            fontSize: 14,
          }}
        >
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 16px" }}>
            Chapter 3 — Stages of sintering (p.7)
          </h3>
          <p>
            The phenomenology of sintering can be divided into successive overlapping stages
            based on the dominant transport mechanism and the geometry of the powder compact.
          </p>
          <p>
            <span
              style={{
                background: "rgba(91, 143, 185, 0.25)",
                padding: "1px 0",
              }}
            >
              {PDF_SOURCE.selectionText}
            </span>
            {" "}This staged view, originally proposed by Kuczynski (1949) and refined
            by Kingery (1958), remains foundational despite later modifications.
          </p>

          {pillVisible && (
            <div
              style={{
                position: "absolute",
                top: 220,
                left: 220,
              }}
            >
              <SelectionPill
                source={PDF_SOURCE}
                onQuoteToNote={() => {
                  console.log("Quote to note");
                  setPillVisible(false);
                }}
                onQuoteToChat={() => {
                  console.log("Quote to chat");
                  setPillVisible(false);
                }}
                onDismiss={() => setPillVisible(false)}
              />
            </div>
          )}

          {!pillVisible && (
            <button
              onClick={() => setPillVisible(true)}
              style={{
                position: "absolute",
                bottom: 16,
                right: 16,
                padding: "6px 12px",
                fontSize: 12,
                borderRadius: 6,
                border: "1px solid var(--color-border)",
                background: "white",
                cursor: "pointer",
              }}
            >
              Reselect
            </button>
          )}
        </div>
      );
    };
    return <Demo />;
  },
};

// ── 3. URL viewer 上に重ねた状態（モック） ──
export const OverUrlViewer: Story = {
  name: "URL viewer 上にフロート",
  render: () => (
    <div
      style={{
        position: "relative",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        overflow: "hidden",
        background: "white",
        padding: 24,
        minHeight: 400,
        color: "var(--ink-2)",
        lineHeight: 1.6,
        fontSize: 13,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 12 }}>
        materialsproject.org/materials/mp-30
      </div>
      <h3 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 12px" }}>
        Copper (Cu) — Properties
      </h3>
      <p>
        Pure copper is a face-centered cubic (FCC) metal with notable thermal and electrical
        conductivity.{" "}
        <span style={{ background: "rgba(75, 122, 82, 0.25)", padding: "1px 0" }}>
          {URL_SOURCE.selectionText}
        </span>{" "}
        The phase diagram below shows the relevant solid-solid transitions under pressure.
      </p>

      <div
        style={{
          position: "absolute",
          top: 140,
          left: 160,
        }}
      >
        <SelectionPill
          source={URL_SOURCE}
          onQuoteToNote={(s) => console.log("Quote to note:", s)}
          onQuoteToChat={(s) => console.log("Quote to chat:", s)}
        />
      </div>
    </div>
  ),
};

// ── 4. 引用ブロックプレビュー（Note 内） ──
export const CitationBlockInNote: Story = {
  name: "引用ブロック（Note 内）",
  parameters: {
    docs: {
      description: {
        story:
          "選択テキストを「Quote → Note」した結果が、Note のドキュメント内にどう挿入されるかのプレビュー。実装時は BlockNote の quote ブロックを使う想定。",
      },
    },
  },
  render: () => (
    <article
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: 24,
        background: "white",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
      }}
    >
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 12px" }}>
        Cu 焼結実験のレビューメモ
      </h1>
      <p style={{ lineHeight: 1.7, fontSize: 14, color: "var(--ink-2)" }}>
        Kingery (1958) は Cu 粉末の焼結を 3 ステージに分け、温度の上昇に伴って律速段階が
        表面拡散から粒界拡散へ移行することを示した。
      </p>
      <CitationBlockPreview source={PDF_SOURCE} />
      <p style={{ lineHeight: 1.7, fontSize: 14, color: "var(--ink-2)" }}>
        このステージ理論は、その後の焼結モデル全般の基礎となっている。MP の Cu フェーズデータも
        この温度域と整合する。
      </p>
      <CitationBlockPreview source={URL_SOURCE} />
    </article>
  ),
};

// ── 5. Composer Quoted state プレビュー ──
export const ComposerQuoted: Story = {
  name: "Composer の quoted state",
  parameters: {
    docs: {
      description: {
        story:
          "「Quote → Chat」した結果が、AI Composer (Ask) にどう渡されるかのプレビュー。実装時は AI assistant store の openChat({ sourceBlockIds, quotedMarkdown }) を呼ぶ。",
      },
    },
  },
  render: () => (
    <div
      style={{
        maxWidth: 480,
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: 12,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
        Composer (Ask)
      </div>
      <ComposerQuotedPreview source={PDF_SOURCE} />
      <ComposerQuotedPreview source={URL_SOURCE} />
      <ComposerQuotedPreview source={SHORT_SOURCE} />
      <textarea
        placeholder="この引用について何を聞きますか？"
        style={{
          width: "100%",
          minHeight: 60,
          padding: 8,
          border: "1px solid var(--color-border)",
          borderRadius: 6,
          fontFamily: "inherit",
          fontSize: 13,
          resize: "vertical",
          marginTop: 8,
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button
          style={{
            padding: "6px 12px",
            background: "var(--color-primary)",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Ask
        </button>
      </div>
    </div>
  ),
};

// ── 6. インタラクション: PDF viewer → 引用 → Note プレビュー ──
export const FullFlowDemo: Story = {
  name: "実運用フロー（PDF → 引用 → Note）",
  render: () => {
    const Demo = () => {
      const [quotes, setQuotes] = useState<CitationSource[]>([]);
      const [pillVisible, setPillVisible] = useState(true);
      return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, minHeight: 500 }}>
          {/* 左: PDF viewer + 選択 */}
          <div
            style={{
              position: "relative",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              overflow: "hidden",
              background: "#f5f5f0",
              padding: 24,
              lineHeight: 1.7,
              fontSize: 13,
            }}
          >
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 12 }}>
              Kingery (1958) — p.{PDF_SOURCE.pageNumber}
            </div>
            <p>
              <span style={{ background: "rgba(91, 143, 185, 0.25)" }}>
                {PDF_SOURCE.selectionText}
              </span>
            </p>
            {pillVisible && (
              <div style={{ position: "absolute", top: 100, left: 80 }}>
                <SelectionPill
                  source={PDF_SOURCE}
                  onQuoteToNote={(s) => {
                    setQuotes((q) => [...q, s]);
                    setPillVisible(false);
                  }}
                  onQuoteToChat={(s) => {
                    console.log("would open Composer with quote:", s);
                    setPillVisible(false);
                  }}
                  onDismiss={() => setPillVisible(false)}
                />
              </div>
            )}
            {!pillVisible && (
              <button
                onClick={() => setPillVisible(true)}
                style={{
                  position: "absolute",
                  bottom: 16,
                  right: 16,
                  padding: "6px 12px",
                  fontSize: 12,
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "white",
                  cursor: "pointer",
                }}
              >
                再選択
              </button>
            )}
          </div>

          {/* 右: Note 編集中 */}
          <article
            style={{
              padding: 16,
              background: "white",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              overflowY: "auto",
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
              焼結レビュー
            </h2>
            <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
              ここに本文を書きながら、左の素材から引用ブロックが追加される。
            </p>
            {quotes.length === 0 ? (
              <div style={{ padding: 12, color: "var(--ink-4)", fontSize: 12 }}>
                (まだ引用なし)
              </div>
            ) : (
              quotes.map((q, i) => <CitationBlockPreview key={i} source={q} />)
            )}
          </article>
        </div>
      );
    };
    return <Demo />;
  },
};
