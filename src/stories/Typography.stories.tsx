// 読みやすさ・タイポグラフィ比較用ストーリー
// dyslexia 観点で Inter / Lexend / Atkinson Hyperlegible を並べて体感比較する

import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta = {
  title: "Foundation/Typography",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "本文の読みやすさを 5 フォントで体感比較。**現行デフォルト = Atkinson Hyperlegible Next + Inter 数字 (B 案)**。dyslexia 配慮（識別性重視の字形）と数字の見慣れたグリフを両立。Inter / Lexend / Atkinson (旧版) / Atkinson Next (生) は body[data-font=\"...\"] で切り替えて比較できる。",
      },
    },
  },
};
export default meta;

const SAMPLE_HEADING = "Cu 粉末アニール実験 S-A の要約";
const SAMPLE_BODY_JA = `600℃ でのアニール処理が Cu 粉末の粒径に与える影響を XRD で評価した。アニール後の粒径は処理前に比べ 2〜3 倍に成長し、X 線回折ピークの半値幅は有意に減少。結晶性の向上が確認された。silica tube による真空封入が前提であり、sample S-B（800℃）との比較で温度依存性を議論できる。`;
const SAMPLE_BODY_EN = `The annealing treatment at 600°C significantly increased the Cu grain size by a factor of 2–3 compared to the pre-treatment state. The full width at half maximum (FWHM) of the XRD peaks decreased meaningfully, indicating improved crystallinity. Vacuum sealing in a silica tube is required. Temperature dependence can be further discussed through comparison with sample S-B (800°C).`;
// dyslexia 字形の混同確認用: b/d/p/q, I/l/1, O/0
const CONFUSABLES = "bdpq Il1 O0 rn/m vv/w cl/d nn/m";

const FONTS = [
  {
    key: "inter" as const,
    name: "Inter",
    family: "'Inter', system-ui, sans-serif",
    note: "中立的なヒューマニスト体。design.md の元の指定。",
    letterSpacing: "0.01em",
  },
  {
    key: "lexend" as const,
    name: "Lexend",
    family: "'Lexend', system-ui, sans-serif",
    note: "NASA 共同研究で読み速度を最適化。可読性のため横幅広め・字間広め。",
    letterSpacing: "0",
  },
  {
    key: "atkinson" as const,
    name: "Atkinson Hyperlegible",
    family: "'Atkinson Hyperlegible', system-ui, sans-serif",
    note: "Braille Institute (2019)。b/d/p/q や I/l/1 を識別性重視で設計。0 は中点入り。",
    letterSpacing: "0",
  },
  {
    key: "atkinson-next" as const,
    name: "Atkinson Hyperlegible Next",
    family: "'Atkinson Hyperlegible Next', system-ui, sans-serif",
    note: "Braille Institute (2024)。Next は字形リファイン版。0 は中点入りのまま。",
    letterSpacing: "0",
  },
  {
    key: "atkinson-next-mixed" as const,
    name: "Atkinson Next + Inter 数字 ★ デフォルト",
    family: "'Inter Numerals', 'Atkinson Hyperlegible Next', system-ui, sans-serif",
    note: "★ 現行デフォルト。数字 0-9 のみ Inter のグリフに差し替え（unicode-range U+0030-0039）。文字部分の dyslexia 配慮を維持しつつ「0」の中点問題を回避。",
    letterSpacing: "0",
  },
];

function Sample({
  family,
  letterSpacing,
}: {
  family: string;
  letterSpacing: string;
}) {
  return (
    <div style={{ fontFamily: family, letterSpacing }}>
      <h1
        style={{
          fontSize: 30,
          fontWeight: 700,
          lineHeight: 1.25,
          margin: "0 0 8px",
          color: "var(--ink)",
        }}
      >
        {SAMPLE_HEADING}
      </h1>
      <h2
        style={{
          fontSize: 24,
          fontWeight: 600,
          lineHeight: 1.3,
          margin: "16px 0 6px",
          color: "var(--ink)",
        }}
      >
        結果（Result）
      </h2>
      <p
        style={{
          fontSize: 16,
          lineHeight: 1.7,
          margin: "0 0 12px",
          color: "var(--ink-2)",
        }}
      >
        {SAMPLE_BODY_JA}
      </p>
      <h3
        style={{
          fontSize: 20,
          fontWeight: 600,
          lineHeight: 1.4,
          margin: "16px 0 6px",
          color: "var(--ink)",
        }}
      >
        Notes
      </h3>
      <p
        style={{
          fontSize: 16,
          lineHeight: 1.7,
          margin: "0 0 12px",
          color: "var(--ink-2)",
        }}
      >
        {SAMPLE_BODY_EN}
      </p>
      <div
        style={{
          fontSize: 14,
          color: "var(--ink-3)",
          marginTop: 12,
          padding: "8px 10px",
          background: "var(--paper-2)",
          borderRadius: "var(--r-2)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div>
          <span style={{ fontFamily: "var(--mono)", marginRight: 8 }}>数字:</span>
          <span style={{ fontSize: 18 }}>0 1 2 3 4 5 6 7 8 9</span>
        </div>
        <div>
          <span style={{ fontFamily: "var(--mono)", marginRight: 8 }}>混同字形:</span>
          {CONFUSABLES}
        </div>
      </div>
    </div>
  );
}

export const ThreeUp: StoryObj = {
  name: "5 フォント並列比較",
  render: () => (
    <div
      style={{
        background: "var(--paper)",
        padding: 24,
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 16,
      }}
    >
      {FONTS.map((f) => (
        <div
          key={f.key}
          style={{
            background: "#fff",
            border: "1px solid var(--rule-2)",
            borderRadius: "var(--r-3)",
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontFamily: "var(--mono)",
              color: "var(--ink-3)",
              marginBottom: 4,
            }}
          >
            {f.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 10 }}>
            {f.note}
          </div>
          <Sample family={f.family} letterSpacing={f.letterSpacing} />
        </div>
      ))}
    </div>
  ),
};

export const InterOnly: StoryObj = {
  name: "Inter 単独",
  render: () => (
    <div style={{ background: "var(--paper)", padding: 32, maxWidth: 720 }}>
      <Sample family={FONTS[0].family} letterSpacing={FONTS[0].letterSpacing} />
    </div>
  ),
};

export const LexendOnly: StoryObj = {
  name: "Lexend 単独",
  render: () => (
    <div style={{ background: "var(--paper)", padding: 32, maxWidth: 720 }}>
      <Sample family={FONTS[1].family} letterSpacing={FONTS[1].letterSpacing} />
    </div>
  ),
};

export const AtkinsonOnly: StoryObj = {
  name: "Atkinson Hyperlegible 単独",
  render: () => (
    <div style={{ background: "var(--paper)", padding: 32, maxWidth: 720 }}>
      <Sample family={FONTS[2].family} letterSpacing={FONTS[2].letterSpacing} />
    </div>
  ),
};

export const AtkinsonNextOnly: StoryObj = {
  name: "Atkinson Hyperlegible Next 単独",
  render: () => (
    <div style={{ background: "var(--paper)", padding: 32, maxWidth: 720 }}>
      <Sample family={FONTS[3].family} letterSpacing={FONTS[3].letterSpacing} />
    </div>
  ),
};

export const AtkinsonNextMixedOnly: StoryObj = {
  name: "Atkinson Next + Inter 数字 単独 (★ 現行デフォルト)",
  render: () => (
    <div style={{ background: "var(--paper)", padding: 32, maxWidth: 720 }}>
      <Sample family={FONTS[4].family} letterSpacing={FONTS[4].letterSpacing} />
    </div>
  ),
};
