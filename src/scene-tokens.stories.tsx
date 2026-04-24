// Scene tokens (oklch) — UX Audit redesign 用プリミティブ
// app.css の :root で定義した oklch ベース・トークンを Storybook で閲覧する。
// 既存の "Atoms/Tokens"（design-guide.stories.tsx）は Tailwind @theme 側、
// こちらは新設 UI 専用の oklch 側を扱う。

import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta = {
  title: "Atoms/Scene Tokens (oklch)",
  parameters: { layout: "padded" },
};
export default meta;

type Token = {
  name: string;
  cssVar: string;
  oklch: string;
  desc?: string;
};

// :root の oklch 値と 1:1 対応（app.css を書き換える場合はここも同期する）
const paper: Token[] = [
  { name: "paper", cssVar: "--paper", oklch: "oklch(0.985 0.005 85)", desc: "本文の紙面・最前面の背景" },
  { name: "paper-2", cssVar: "--paper-2", oklch: "oklch(0.972 0.006 85)", desc: "パネル・区切り" },
  { name: "paper-3", cssVar: "--paper-3", oklch: "oklch(0.955 0.008 85)", desc: "一段奥のサーフェス" },
];
const ink: Token[] = [
  { name: "ink", cssVar: "--ink", oklch: "oklch(0.22 0.01 85)", desc: "主テキスト" },
  { name: "ink-2", cssVar: "--ink-2", oklch: "oklch(0.38 0.01 85)", desc: "本文・補助" },
  { name: "ink-3", cssVar: "--ink-3", oklch: "oklch(0.56 0.01 85)", desc: "メタ情報" },
  { name: "ink-4", cssVar: "--ink-4", oklch: "oklch(0.72 0.008 85)", desc: "プレースホルダ・アイコン" },
];
const rule: Token[] = [
  { name: "rule", cssVar: "--rule", oklch: "oklch(0.90 0.006 85)", desc: "標準罫線" },
  { name: "rule-2", cssVar: "--rule-2", oklch: "oklch(0.94 0.006 85)", desc: "微細罫線" },
];

type Accent = { name: string; tokens: Token[]; use: string };
const accents: Accent[] = [
  {
    name: "Forest（ブランド / 来歴）",
    use: "プライマリ・PROV 来歴・ブランドグリーン。既存 #4B7A52 とほぼ同値。",
    tokens: [
      { name: "forest", cssVar: "--forest", oklch: "oklch(0.48 0.09 150)" },
      { name: "forest-soft", cssVar: "--forest-soft", oklch: "oklch(0.94 0.04 150)" },
      { name: "forest-ink", cssVar: "--forest-ink", oklch: "oklch(0.30 0.08 150)" },
    ],
  },
  {
    name: "Amber（発見 / 下書き）",
    use: "発見カード・Draft ステータス・警告系 Lint。",
    tokens: [
      { name: "amber", cssVar: "--amber", oklch: "oklch(0.68 0.14 60)" },
      { name: "amber-soft", cssVar: "--amber-soft", oklch: "oklch(0.94 0.07 70)" },
      { name: "amber-ink", cssVar: "--amber-ink", oklch: "oklch(0.42 0.12 55)" },
    ],
  },
  {
    name: "Rose（注意 / エラー / 結果）",
    use: "Output ラベル・エラー系 Lint・矛盾警告。",
    tokens: [
      { name: "rose", cssVar: "--rose", oklch: "oklch(0.62 0.14 25)" },
      { name: "rose-soft", cssVar: "--rose-soft", oklch: "oklch(0.95 0.04 25)" },
    ],
  },
  {
    name: "Sky（AI / リンク / 情報）",
    use: "AI バッジ・CITE ブロック・情報系 Lint。",
    tokens: [
      { name: "sky", cssVar: "--sky", oklch: "oklch(0.60 0.10 230)" },
      { name: "sky-soft", cssVar: "--sky-soft", oklch: "oklch(0.95 0.035 230)" },
      { name: "sky-ink", cssVar: "--sky-ink", oklch: "oklch(0.38 0.09 230)" },
    ],
  },
];

const font = "'Inter', system-ui, sans-serif";
const mono = "ui-monospace, 'SF Mono', monospace";

const h2Style: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  marginBottom: 4,
  color: "var(--ink)",
  fontFamily: font,
};
const leadStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--ink-3)",
  marginBottom: 14,
  fontFamily: font,
  maxWidth: "60ch",
  lineHeight: 1.6,
};
const sectionStyle: React.CSSProperties = {
  marginBottom: 32,
  fontFamily: font,
};

function Swatch({ cssVar, size = 44 }: { cssVar: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "var(--r-2)",
        backgroundColor: `var(${cssVar})`,
        border: "1px solid var(--rule)",
        flexShrink: 0,
      }}
    />
  );
}

function TokenRow({ token }: { token: Token }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Swatch cssVar={token.cssVar} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
          {token.name}
          <code style={{ fontSize: 11, marginLeft: 8, fontFamily: mono, color: "var(--ink-3)", fontWeight: 400 }}>
            var({token.cssVar})
          </code>
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: mono }}>{token.oklch}</div>
        {token.desc && <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}>{token.desc}</div>}
      </div>
    </div>
  );
}

export const Palette: StoryObj = {
  name: "パレット",
  render: () => (
    <div style={{ maxWidth: 720, fontFamily: font, color: "var(--ink)" }}>
      <section style={sectionStyle}>
        <h2 style={h2Style}>Paper（背景系ニュートラル）</h2>
        <p style={leadStyle}>
          書き面・カード・サブサーフェスの 3 階層。純白を避け、わずかに暖色（hue=85）を帯びる。
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {paper.map((t) => (
            <TokenRow key={t.name} token={t} />
          ))}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Ink（テキスト階層）</h2>
        <p style={leadStyle}>主要テキスト → 補助 → メタ → プレースホルダの 4 段階。</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {ink.map((t) => (
            <TokenRow key={t.name} token={t} />
          ))}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Rule（罫線）</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rule.map((t) => (
            <TokenRow key={t.name} token={t} />
          ))}
        </div>
      </section>

      {accents.map((group) => (
        <section key={group.name} style={sectionStyle}>
          <h2 style={h2Style}>{group.name}</h2>
          <p style={leadStyle}>{group.use}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {group.tokens.map((t) => (
              <TokenRow key={t.name} token={t} />
            ))}
          </div>
        </section>
      ))}
    </div>
  ),
};

// ── ステータスピル & severity バッジのビジュアル確認 ──

function Pill({
  bg,
  fg,
  border,
  children,
}: {
  bg: string;
  fg: string;
  border?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 10px",
        borderRadius: "var(--pill)",
        backgroundColor: bg,
        color: fg,
        border: border ? `1px solid ${border}` : "1px solid transparent",
        fontSize: 11,
        fontWeight: 500,
        fontFamily: mono,
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </span>
  );
}

export const StatusPills: StoryObj = {
  name: "ステータス & Severity",
  render: () => (
    <div style={{ maxWidth: 720, fontFamily: font, color: "var(--ink)" }}>
      <section style={sectionStyle}>
        <h2 style={h2Style}>Wiki ステータス</h2>
        <p style={leadStyle}>
          AI 生成 Wiki の draft / published ステータスを示すピル。Forest / Amber を用途で分ける。
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Pill bg="var(--amber-soft)" fg="var(--amber-ink)">draft</Pill>
          <Pill bg="var(--forest-soft)" fg="var(--forest-ink)">published</Pill>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Health Check Severity</h2>
        <p style={leadStyle}>Lint 結果の重要度バッジ。oklch 色相だけで区別し、形状は統一。</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Pill bg="oklch(0.96 0.04 25)" fg="var(--rose)" border="oklch(0.85 0.08 25)">⚠ error</Pill>
          <Pill bg="var(--amber-soft)" fg="var(--amber-ink)" border="oklch(0.85 0.08 60)">⚠ warning</Pill>
          <Pill bg="var(--sky-soft)" fg="var(--sky-ink)" border="oklch(0.85 0.06 230)">💡 info</Pill>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Radii（角丸）</h2>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {[
            { label: "--r-1 (6px)", radius: "var(--r-1)" },
            { label: "--r-2 (8px)", radius: "var(--r-2)" },
            { label: "--r-3 (10px)", radius: "var(--r-3)" },
            { label: "--pill", radius: "var(--pill)" },
          ].map((r) => (
            <div key={r.label} style={{ textAlign: "center" }}>
              <div
                style={{
                  width: 88,
                  height: 52,
                  borderRadius: r.radius,
                  background: "var(--forest-soft)",
                  border: "1px solid var(--forest)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  color: "var(--forest-ink)",
                  fontWeight: 600,
                  fontFamily: mono,
                }}
              >
                {r.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Shadows</h2>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {[
            { label: "--shadow-1", shadow: "var(--shadow-1)" },
            { label: "--shadow-2", shadow: "var(--shadow-2)" },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                width: 140,
                height: 72,
                borderRadius: "var(--r-3)",
                background: "var(--paper)",
                border: "1px solid var(--rule)",
                boxShadow: s.shadow,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                color: "var(--ink-2)",
                fontFamily: mono,
              }}
            >
              {s.label}
            </div>
          ))}
        </div>
      </section>
    </div>
  ),
};

// ── Forest が既存 #4B7A52 とほぼ等価なことを目視確認 ──
export const BrandBridge: StoryObj = {
  name: "ブランドブリッジ（既存 #4B7A52 ↔ --forest）",
  render: () => (
    <div style={{ maxWidth: 720, fontFamily: font, color: "var(--ink)" }}>
      <section style={sectionStyle}>
        <h2 style={h2Style}>既存ブランドとの互換確認</h2>
        <p style={leadStyle}>
          既存 Tailwind テーマの <code style={{ fontFamily: mono, fontSize: 11 }}>#4B7A52</code>（<code style={{ fontFamily: mono, fontSize: 11 }}>--color-primary</code>）と
          新設 <code style={{ fontFamily: mono, fontSize: 11 }}>--forest: oklch(0.48 0.09 150)</code> がほぼ同値であることを、左右に並べて目視確認する。
          ずれが大きい場合は <code style={{ fontFamily: mono, fontSize: 11 }}>app.css</code> の oklch 値を調整すること。
        </p>
        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                width: 160,
                height: 120,
                borderRadius: "var(--r-3)",
                background: "#4B7A52",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: mono,
                fontSize: 12,
              }}
            >
              #4B7A52
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>既存 --color-primary</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                width: 160,
                height: 120,
                borderRadius: "var(--r-3)",
                background: "var(--forest)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: mono,
                fontSize: 12,
              }}
            >
              --forest
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
              oklch(0.48 0.09 150)
            </div>
          </div>
        </div>
      </section>
    </div>
  ),
};
