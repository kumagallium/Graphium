// 全体グラフ（俯瞰）に「構造」を入れる提案の Storybook（合意用）。
//
// 背景: 俯瞰は fcose の定数（反発・自然長・重力）だけで並べ、大きさは種類ごとの固定値。
// 構造に由来する量を何も使っていないので、実データ（ノート138・知見780）では
// 赤い知見の面積が画面を埋めるだけになる。Graphium で大事なのは「ノートをまたぐ
// つながり」。それが目立つ絵にしたい。
//
// 提案（props で切替。既定 OFF = 今の挙動）:
//   1. foldLeaves: ノート以外で次数1の「葉」（知見・原料・話題）を、繋がる相手に
//      畳んで「+n」にまとめる。骨格（ノート間のつながり）が見えやすくなるはず。
//   2. sizeMode: ノートの大きさを、2 ホップ以内で届く別のノートの数（つながりの
//      多さ）で決める。ハブになっているノートが視覚的に目立つ。
//
// 本ストーリーは視覚合意用。データは決定的な疑似乱数で生成したパン作りの
// 世界観の砂時計データ（実際の研究内容・企業名は含まない）。
// レイアウト（fcose の定数）はこの PR では触っていない。

import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { GlobalGraphView } from "./global-graph-view";
import type { NoteNode, NoteEdge, NoteGraphData } from "./graph-builder";

// ── 決定的な疑似乱数（mulberry32） ─────────────────────

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── サンプルデータ生成（パン作りの世界観・連番で十分） ──────

const NOTE_CONTEXTS = ["春の試作", "秋の試作", "粉の比較"];
const NOTE_PHRASES = [
  "粉の配合", "一次発酵", "二次発酵", "成形", "焼成温度の検討", "冷却まとめ",
  "加水率の検討", "捏ね時間の検討", "粉の比較", "保存性メモ", "塩分量の検討",
  "オーブンの癖", "生地の伸び確認", "気泡の観察", "焼き色の比較",
];
const CLAIM_PHRASES = [
  "高温発酵で気泡が大きくなる", "加水率を上げると伸びが良くなる", "捏ね過ぎるとグルテンが切れる",
  "焼成温度が高いと皮が厚くなる", "塩を後入れすると発酵が速い", "粉の粒度で吸水量が変わる",
  "二次発酵の見極めが難しい", "室温が高いと発酵が早い", "生地温度が仕上がりを左右する",
  "オーブンの位置で焼き色が変わる",
];
const ATOM_PHRASES = ["加水率と伸びの関係", "発酵温度と気泡の関係", "捏ね時間とグルテンの関係", "焼成温度と皮の厚さの関係"];
const TOPIC_NAMES = [
  "発酵の温度管理", "加水率と生地", "捏ねとグルテン", "焼成の温度", "粉の選び方",
  "塩の入れ方", "皮と気泡", "保存性", "オーブンの癖", "生地の伸び", "焼き色の違い", "総合まとめ",
];
const EXT_TYPES: Array<"pdf" | "url" | "document" | "chat" | "memo"> = ["pdf", "url", "document", "chat", "memo"];
const EXT_TITLE_BASE: Record<string, string> = {
  pdf: "配合表", url: "レシピ考察", document: "実験ノート", chat: "作業チャット", memo: "覚え書き",
};

/** ノート138・外部ソース110・知見700・洞察64・話題44 の砂時計データを組む。 */
function buildSampleData(): NoteGraphData {
  const rng = mulberry32(20260925);
  const nodes: NoteNode[] = [];
  const edges: NoteEdge[] = [];

  // ノート間の「派生」の鎖（長さ 3〜6 ×20本、合計が 120 になるよう調整）。
  const NOTE_TOTAL = 138;
  const CHAIN_COUNT = 20;
  const chainLengths: number[] = [];
  for (let i = 0; i < CHAIN_COUNT; i++) chainLengths.push(randInt(rng, 3, 6));
  let deficit = NOTE_TOTAL - chainLengths.reduce((a, b) => a + b, 0);
  // 20 本×最大 6 = 120 では 138 に届かないので、上限 6 を外して埋める
  // （鎖の長さの見た目は変わるが、鎖と参照の作り方自体は変えていない）。
  while (deficit > 0) {
    const idx = randInt(rng, 0, CHAIN_COUNT - 1);
    chainLengths[idx]++;
    deficit--;
  }

  const noteIdsByChain: string[][] = [];
  let noteCounter = 0;
  for (let c = 0; c < CHAIN_COUNT; c++) {
    const ctx = pick(rng, NOTE_CONTEXTS);
    const ids: string[] = [];
    for (let k = 0; k < chainLengths[c]; k++) {
      noteCounter++;
      const id = `n${noteCounter}`;
      const phrase = pick(rng, NOTE_PHRASES);
      nodes.push({ id, title: `${phrase} ${noteCounter}`, isCurrent: false, hop: 0, noteContexts: [ctx] });
      ids.push(id);
    }
    noteIdsByChain.push(ids);
    for (let k = 0; k < ids.length - 1; k++) {
      edges.push({ source: ids[k], target: ids[k + 1], relation: "derived" });
    }
  }
  const allNoteIds = noteIdsByChain.flat();

  // 鎖をまたぐ「参照」30 本。うち 15 本は意図的に作ったハブ 5 つに集中させる
  // （つながりで大きさ を相対値にしたときに差が出るよう、参照を多く受けるノートを作る）。
  const hubNoteIds = shuffle(rng, allNoteIds).slice(0, 5);
  for (let i = 0; i < 15; i++) {
    const target = pick(rng, hubNoteIds);
    let source = pick(rng, allNoteIds);
    if (source === target) source = pick(rng, allNoteIds);
    if (source === target) continue;
    edges.push({ source, target, relation: "reference" });
  }
  for (let i = 0; i < 15; i++) {
    const a = pick(rng, allNoteIds);
    const b = pick(rng, allNoteIds);
    if (a === b) continue;
    edges.push({ source: a, target: b, relation: "reference" });
  }

  // 外部ソース 110（各 1〜2 ノートに used）
  for (let i = 1; i <= 110; i++) {
    const type = pick(rng, EXT_TYPES);
    const id = `${type}:src${i}`;
    nodes.push({ id, title: `${EXT_TITLE_BASE[type]} ${i}`, isCurrent: false, hop: 0, external: type });
    const targets = shuffle(rng, allNoteIds).slice(0, randInt(rng, 1, 2));
    for (const targetId of targets) edges.push({ source: id, target: targetId, relation: "used" });
  }

  // 知見（claim）700: 9割(630)は1ノートにだけ繋がる葉、1割(70)は2〜3ノートを共有
  const claimIds: string[] = [];
  let claimCounter = 0;
  for (let i = 0; i < 630; i++) {
    claimCounter++;
    const id = `c${claimCounter}`;
    nodes.push({
      id,
      title: `${pick(rng, CLAIM_PHRASES)} ${claimCounter}`,
      isCurrent: false,
      hop: 0,
      isWiki: true,
      wikiKind: "claim",
    });
    claimIds.push(id);
    edges.push({ source: pick(rng, allNoteIds), target: id, relation: "derived" });
  }
  for (let i = 0; i < 70; i++) {
    claimCounter++;
    const id = `c${claimCounter}`;
    nodes.push({
      id,
      title: `${pick(rng, CLAIM_PHRASES)} ${claimCounter}`,
      isCurrent: false,
      hop: 0,
      isWiki: true,
      wikiKind: "claim",
    });
    claimIds.push(id);
    const notesFor = shuffle(rng, allNoteIds).slice(0, randInt(rng, 2, 3));
    for (const noteId of notesFor) edges.push({ source: noteId, target: id, relation: "derived" });
  }

  // 洞察（atom）64: 各 2〜4 件の知見から派生
  for (let i = 1; i <= 64; i++) {
    const id = `a${i}`;
    nodes.push({ id, title: `${pick(rng, ATOM_PHRASES)} ${i}`, isCurrent: false, hop: 0, isWiki: true, wikiKind: "atom" });
    const claimsFor = shuffle(rng, claimIds).slice(0, randInt(rng, 2, 4));
    for (const claimId of claimsFor) edges.push({ source: claimId, target: id, relation: "derived" });
  }

  // 話題（topic）44: 各 10〜40 件の知見を束ねる（名前は循環させて連番を振る）
  for (let i = 0; i < 44; i++) {
    const id = `t${i + 1}`;
    const baseName = TOPIC_NAMES[i % TOPIC_NAMES.length];
    const title = i < TOPIC_NAMES.length ? baseName : `${baseName} ${Math.floor(i / TOPIC_NAMES.length) + 1}`;
    nodes.push({ id, title, isCurrent: false, hop: 0, isWiki: true, wikiKind: "topic" });
    const claimsFor = shuffle(rng, claimIds).slice(0, randInt(rng, 10, 40));
    for (const claimId of claimsFor) edges.push({ source: claimId, target: id, relation: "derived" });
  }

  return { nodes, edges };
}

const SAMPLE_DATA = buildSampleData();

// ── 共通部品（plan-flow-groups.proposal と同じ流儀） ────────

function CaseNote({ title, points }: { title: string; points: string[] }) {
  return (
    <div className="w-[300px] shrink-0 p-6 text-xs text-muted-foreground space-y-2 border-l border-border overflow-y-auto">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {points.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

function Frame({ children, note }: { children: ReactNode; note: ReactNode }) {
  return (
    <div className="flex" style={{ height: "100vh" }}>
      <div className="flex-1 min-w-0">{children}</div>
      {note}
    </div>
  );
}

function noop() {
  // Storybook 合意用なのでナビゲーションは配線しない
}

// ── ストーリー ─────────────────────────────────────────

const meta: Meta = {
  title: "Proposal/全体グラフの構造",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "全体グラフ（俯瞰）に構造由来の量（葉を畳む・つながりで大きさ）を持ち込む提案。ヘッダーの「葉を畳む」チェックと「大きさ」セグメントで実際に切り替えられる。",
      },
    },
  },
};
export default meta;
type Story = StoryObj;

export const AsIs: Story = {
  name: "1. 現状",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="現状（props 既定）"
          points={[
            "畳まない・大きさは種類ごとの固定値。ノート 138・外部ソース 110・知見 700・洞察 64・話題 44。",
            "知見（赤系）の面積が画面を埋め、骨格になるはずの「ノートをまたぐつながり」が埋もれて見えにくい。",
            "ヘッダーの「葉を畳む」チェック・「大きさ」セグメントは触れる状態。切り替えて 2・3 と見比べられる。",
          ]}
        />
      }
    >
      <GlobalGraphView data={SAMPLE_DATA} onClose={noop} onSelectNote={noop} />
    </Frame>
  ),
};

export const FoldLeaves: Story = {
  name: "2. 葉を畳む",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="foldLeaves: ON"
          points={[
            "1 本の線でしかつながっていない知見・原料（葉）を、繋がる相手（多くはノート）に畳んで「+n」で表す。",
            "畳んだノードは枠が 1 段太くなる。畳んだ合計はヘッダーの「葉を畳む」チェックの横に (−n) で出る。",
            "ノート間の骨格（鎖・参照）がどれだけ見やすくなったかを見る。ノート数自体は変わらない。",
          ]}
        />
      }
    >
      <GlobalGraphView data={SAMPLE_DATA} onClose={noop} onSelectNote={noop} initialFoldLeaves />
    </Frame>
  ),
};

export const FoldAndReach: Story = {
  name: "3. 畳む + つながりで大きさ",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="foldLeaves: ON + sizeMode: reach"
          points={[
            "葉を畳んだ上で、ノートの大きさを「2 ホップ以内で届く別のノートの数」で決める。",
            "鎖の途中にいて知見・原料を多く共有するノートほど大きく見えるはず（ハブが目立つ）。",
            "知見・洞察・話題・外部ソースの大きさは変えていない（種類ごとの固定値のまま）。",
            "fcose のレイアウト定数はどのストーリーも共通（この PR では触っていない）。詰まって見えるかは目視で確認する。",
          ]}
        />
      }
    >
      <GlobalGraphView
        data={SAMPLE_DATA}
        onClose={noop}
        onSelectNote={noop}
        initialFoldLeaves
        initialSizeMode="reach"
      />
    </Frame>
  ),
};
