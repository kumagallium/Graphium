// 全体グラフ（俯瞰）の構造由来の表示（葉を畳む・つながりで大きさ・島の配置）の
// Storybook。
//
// 背景: 俯瞰は元々 fcose の定数（反発・自然長・重力）だけで並べ、大きさは種類
// ごとの固定値だった。構造に由来する量を何も使わないと、実データ（ノート138・
// 知見700 規模）では知見の面積が画面を埋めるだけになり、Graphium で大事な
// 「ノートをまたぐつながり」が埋もれてしまう。ここで合意した 3 つの切替:
//   1. foldLeaves: フォーカス種類以外で次数1の「葉」（知見・原料など）を、
//      繋がる相手に畳んで「+n」（衛星）にまとめる。骨格が見えやすくなる。
//   2. sizeMode: ノート（または islands のフォーカス種類）の大きさを、つながりの
//      多さ（reach）で決める。ハブが視覚的に目立つ。
//   3. layoutMode: "islands" にすると、層チップが「フォーカス」（島の中心に
//      する種類）に変わり、ラベル伝播 + 重心 + 2 段階配置で島を作る。
//
// データは決定的な疑似乱数で生成したパン作りの世界観の砂時計データ
// （実際の研究内容・企業名は含まない）。

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

// 12 の「試作シリーズ」＝季節ごとの試作ロット（noteContexts に使う名前そのもの）
const SERIES_NAMES = [
  "早春の試作", "春の試作", "晩春の試作", "初夏の試作", "梅雨の試作", "盛夏の試作",
  "晩夏の試作", "初秋の試作", "秋の試作", "晩秋の試作", "初冬の試作", "厳冬の試作",
];
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

/**
 * ノート138・外部ソース110・知見700・洞察64・話題44 の砂時計データを組む。
 * ノートは 12 の試作シリーズ（各 8〜14 ノート）に分け、鎖・参照・知見の共有は
 * シリーズの中を基本にする（layoutMode: islands で「島」ができる種にする）。
 */
function buildSampleData(): NoteGraphData {
  const rng = mulberry32(20260925);
  const nodes: NoteNode[] = [];
  const edges: NoteEdge[] = [];

  // ノート 138 を 12 の「試作シリーズ」（各 8〜14 ノート）に分ける。
  // 派生の鎖・参照・知見の共有はシリーズの中を基本にし、シリーズをまたぐ参照は
  // ごく少数だけにする——これが「島」の種になる（島にならない構造からは
  // どんな引力係数を使っても島は生まれない）。
  const NOTE_TOTAL = 138;
  const SERIES_COUNT = 12;
  const seriesSizes: number[] = [];
  for (let i = 0; i < SERIES_COUNT; i++) seriesSizes.push(randInt(rng, 8, 14));
  let deficit = NOTE_TOTAL - seriesSizes.reduce((a, b) => a + b, 0);
  // 8〜14 の範囲を保ったまま、決定的に（インデックスを順に回して）埋める/削る。
  let cursor = 0;
  while (deficit !== 0) {
    const idx = cursor % SERIES_COUNT;
    cursor++;
    if (deficit > 0 && seriesSizes[idx] < 14) {
      seriesSizes[idx]++;
      deficit--;
    } else if (deficit < 0 && seriesSizes[idx] > 8) {
      seriesSizes[idx]--;
      deficit++;
    }
  }

  const seriesNoteIds: string[][] = [];
  let noteCounter = 0;
  for (let s = 0; s < SERIES_COUNT; s++) {
    const ctx = SERIES_NAMES[s];
    const ids: string[] = [];
    for (let k = 0; k < seriesSizes[s]; k++) {
      noteCounter++;
      const id = `n${noteCounter}`;
      const phrase = pick(rng, NOTE_PHRASES);
      nodes.push({ id, title: `${phrase} ${noteCounter}`, isCurrent: false, hop: 0, noteContexts: [ctx] });
      ids.push(id);
    }
    seriesNoteIds.push(ids);
    // シリーズ内の派生の鎖（そのシリーズの全ノートを 1 本の鎖でつなぐ）
    for (let k = 0; k < ids.length - 1; k++) {
      edges.push({ source: ids[k], target: ids[k + 1], relation: "derived" });
    }
  }
  const allNoteIds = seriesNoteIds.flat();

  // シリーズ内の「参照」40 本
  for (let i = 0; i < 40; i++) {
    const si = randInt(rng, 0, SERIES_COUNT - 1);
    const ids = seriesNoteIds[si];
    const a = pick(rng, ids);
    let b = pick(rng, ids);
    if (a === b) b = pick(rng, ids);
    if (a === b) continue;
    edges.push({ source: a, target: b, relation: "reference" });
  }

  // シリーズをまたぐ参照は 12 本だけ。うち 8 本は 5 つのハブ（5 シリーズの中心ノート）
  // に集める。残り 4 本はどのシリーズとも無関係にランダムな橋を架ける。
  const hubSeriesIdx = shuffle(
    rng,
    Array.from({ length: SERIES_COUNT }, (_, i) => i),
  ).slice(0, 5);
  const hubNoteIds = hubSeriesIdx.map((si) => seriesNoteIds[si][Math.floor(seriesNoteIds[si].length / 2)]);
  for (let i = 0; i < 8; i++) {
    const target = pick(rng, hubNoteIds);
    const targetSeriesIdx = seriesNoteIds.findIndex((ids) => ids.includes(target));
    let sourceSeriesIdx = randInt(rng, 0, SERIES_COUNT - 1);
    if (sourceSeriesIdx === targetSeriesIdx) sourceSeriesIdx = (sourceSeriesIdx + 1) % SERIES_COUNT;
    const source = pick(rng, seriesNoteIds[sourceSeriesIdx]);
    edges.push({ source, target, relation: "reference" });
  }
  for (let i = 0; i < 4; i++) {
    let aSeriesIdx = randInt(rng, 0, SERIES_COUNT - 1);
    let bSeriesIdx = randInt(rng, 0, SERIES_COUNT - 1);
    if (bSeriesIdx === aSeriesIdx) bSeriesIdx = (bSeriesIdx + 1) % SERIES_COUNT;
    const a = pick(rng, seriesNoteIds[aSeriesIdx]);
    const b = pick(rng, seriesNoteIds[bSeriesIdx]);
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

  // ノート id → シリーズ番号（知見がどのシリーズに属するかを追うために使う。
  // 話題はシリーズをまたがない——知見の一次所属を選ぶ元データがシリーズ単位なため）。
  const seriesIdxByNoteId = new Map<string, number>();
  seriesNoteIds.forEach((ids, si) => {
    for (const id of ids) seriesIdxByNoteId.set(id, si);
  });

  // 知見（claim）700: 9割(630)は1ノートにだけ繋がる葉、1割(70)は2〜3ノートを共有
  const claimIds: string[] = [];
  // シリーズ番号 → そのシリーズのノートに付いた知見 id（話題の割り当て元）
  const claimsBySeriesIdx: string[][] = Array.from({ length: SERIES_COUNT }, () => []);
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
    const noteId = pick(rng, allNoteIds);
    edges.push({ source: noteId, target: id, relation: "derived" });
    claimsBySeriesIdx[seriesIdxByNoteId.get(noteId)!].push(id);
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
    // 知見の共有もシリーズの中を基本にする（シリーズをまたいで共有すると、
    // その知見の辺が島を橋渡ししてしまい「島」が崩れる）。
    const si = randInt(rng, 0, SERIES_COUNT - 1);
    const notesFor = shuffle(rng, seriesNoteIds[si]).slice(0, randInt(rng, 2, 3));
    for (const noteId of notesFor) edges.push({ source: noteId, target: id, relation: "derived" });
    claimsBySeriesIdx[si].push(id);
  }

  // 洞察（atom）64: 各 2〜4 件の知見から派生
  for (let i = 1; i <= 64; i++) {
    const id = `a${i}`;
    nodes.push({ id, title: `${pick(rng, ATOM_PHRASES)} ${i}`, isCurrent: false, hop: 0, isWiki: true, wikiKind: "atom" });
    const claimsFor = shuffle(rng, claimIds).slice(0, randInt(rng, 2, 4));
    for (const claimId of claimsFor) edges.push({ source: claimId, target: id, relation: "derived" });
  }

  // 話題（topic）44: シリーズごとに 3〜4 個作り、そのシリーズの知見（claim）から
  // 5〜25 件ずつ選ぶ（合計 440 件。話題はシリーズをまたがない）。実際の
  // Graphium では知見は話題 1 つに属するのが普通なので、割り当てた 440 件の
  // うち 12% だけを 2 つ目の話題（同じシリーズの他の話題を優先）にも足す。
  // 残り 260 件は話題を持たない（後段の analyzeCrystalIslands で衛星になる）。
  const topicsPerSeries: number[] = [];
  for (let s = 0; s < SERIES_COUNT; s++) topicsPerSeries.push(randInt(rng, 3, 4));
  const TOPIC_TOTAL = 44;
  let topicDeficit = TOPIC_TOTAL - topicsPerSeries.reduce((a, b) => a + b, 0);
  let topicCursor = 0;
  while (topicDeficit !== 0) {
    const idx = topicCursor % SERIES_COUNT;
    topicCursor++;
    if (topicDeficit > 0 && topicsPerSeries[idx] < 4) {
      topicsPerSeries[idx]++;
      topicDeficit--;
    } else if (topicDeficit < 0 && topicsPerSeries[idx] > 3) {
      topicsPerSeries[idx]--;
      topicDeficit++;
    }
  }

  const claimCountPerTopic: number[] = [];
  for (let i = 0; i < TOPIC_TOTAL; i++) claimCountPerTopic.push(randInt(rng, 5, 25));
  const CLAIM_ASSIGN_TOTAL = 440;
  let claimAssignDeficit = CLAIM_ASSIGN_TOTAL - claimCountPerTopic.reduce((a, b) => a + b, 0);
  let claimAssignCursor = 0;
  while (claimAssignDeficit !== 0) {
    const idx = claimAssignCursor % TOPIC_TOTAL;
    claimAssignCursor++;
    if (claimAssignDeficit > 0 && claimCountPerTopic[idx] < 25) {
      claimCountPerTopic[idx]++;
      claimAssignDeficit--;
    } else if (claimAssignDeficit < 0 && claimCountPerTopic[idx] > 5) {
      claimCountPerTopic[idx]--;
      claimAssignDeficit++;
    }
  }

  const topicIdsBySeries: string[][] = [];
  const primaryTopicOfClaim = new Map<string, string>();
  let topicCounter = 0;
  let claimCountCursor = 0;
  for (let s = 0; s < SERIES_COUNT; s++) {
    const availableClaims = shuffle(rng, claimsBySeriesIdx[s]);
    let consumed = 0;
    const seriesTopicIds: string[] = [];
    for (let k = 0; k < topicsPerSeries[s]; k++) {
      topicCounter++;
      const id = `t${topicCounter}`;
      const baseName = TOPIC_NAMES[(topicCounter - 1) % TOPIC_NAMES.length];
      const title =
        topicCounter <= TOPIC_NAMES.length
          ? baseName
          : `${baseName} ${Math.floor((topicCounter - 1) / TOPIC_NAMES.length) + 1}`;
      nodes.push({ id, title, isCurrent: false, hop: 0, isWiki: true, wikiKind: "topic" });
      seriesTopicIds.push(id);

      const want = Math.max(0, Math.min(claimCountPerTopic[claimCountCursor], availableClaims.length - consumed));
      claimCountCursor++;
      const picked = availableClaims.slice(consumed, consumed + want);
      consumed += picked.length;
      for (const claimId of picked) {
        edges.push({ source: claimId, target: id, relation: "derived" });
        if (!primaryTopicOfClaim.has(claimId)) primaryTopicOfClaim.set(claimId, id);
      }
    }
    topicIdsBySeries.push(seriesTopicIds);
  }

  // 割り当てた知見の 12% だけが 2 つ目の話題にも属する（同じシリーズの他の
  // 話題を優先。無ければ 2 つ目は付けない）。
  const assignedClaimIds = [...primaryTopicOfClaim.keys()];
  const secondaryCount = Math.round(assignedClaimIds.length * 0.12);
  const secondaryCandidates = shuffle(rng, assignedClaimIds).slice(0, secondaryCount);
  for (const claimId of secondaryCandidates) {
    const primaryTopicId = primaryTopicOfClaim.get(claimId)!;
    const seriesIdx = topicIdsBySeries.findIndex((ids) => ids.includes(primaryTopicId));
    const sameSeriesTopics = topicIdsBySeries[seriesIdx].filter((id) => id !== primaryTopicId);
    if (sameSeriesTopics.length === 0) continue;
    const secondTopicId = pick(rng, sameSeriesTopics);
    edges.push({ source: claimId, target: secondTopicId, relation: "derived" });
  }

  return { nodes, edges };
}

export const SAMPLE_DATA = buildSampleData();

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
  // Storybook の見比べ用なのでナビゲーションは配線しない
}

// ── ストーリー ─────────────────────────────────────────

const meta: Meta = {
  title: "Graph/GlobalGraphStructure",
  // SAMPLE_DATA は検証スクリプトから読むための export。ストーリーとして拾わせない
  excludeStories: ["SAMPLE_DATA"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "全体グラフ（俯瞰）の構造由来の表示: 葉を畳む・つながりで大きさ・島の配置。ヘッダーの「葉を畳む」チェック・「大きさ」「配置」セグメントで実際に切り替えられる。既定は 4（島・ノート中心）と同じ。",
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
          title="foldLeaves: OFF / sizeMode: kind / layoutMode: plain"
          points={[
            "畳まない・大きさは種類ごとの固定値。ノート 138・外部ソース 110・知見 700・洞察 64・話題 44。",
            "見るべきところ: 知見（赤系）の面積が画面を埋め、骨格になるはずの「ノートをまたぐつながり」が埋もれて見えにくいこと。",
            "ヘッダーの「葉を畳む」チェック・「大きさ」「配置」セグメントは触れる状態。切り替えて 2〜4 と見比べられる。",
          ]}
        />
      }
    >
      <GlobalGraphView
        data={SAMPLE_DATA}
        onClose={noop}
        onSelectNote={noop}
        initialFoldLeaves={false}
        initialSizeMode="kind"
        initialLayoutMode="plain"
      />
    </Frame>
  ),
};

export const FoldLeaves: Story = {
  name: "2. 葉を畳む",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="foldLeaves: ON / sizeMode: kind / layoutMode: plain"
          points={[
            "1 本の線でしかつながっていない知見・原料（葉）を、繋がる相手（多くはノート）に畳んで「+n」で表す。",
            "見るべきところ: 畳んだノードは枠が 1 段太くなる。畳んだ合計はヘッダーの「葉を畳む」チェックの横に (−n) で出る。",
            "ノート間の骨格（鎖・参照）がどれだけ見やすくなったかを見る。ノート数自体は変わらない。",
          ]}
        />
      }
    >
      <GlobalGraphView
        data={SAMPLE_DATA}
        onClose={noop}
        onSelectNote={noop}
        initialFoldLeaves
        initialSizeMode="kind"
        initialLayoutMode="plain"
      />
    </Frame>
  ),
};

export const FoldAndReach: Story = {
  name: "3. 畳む + つながりで大きさ",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="foldLeaves: ON / sizeMode: reach / layoutMode: plain"
          points={[
            "葉を畳んだ上で、ノートの大きさを「2 ホップ以内で届く別のノートの数」で決める。",
            "見るべきところ: 鎖の途中にいて知見・原料を多く共有するノートほど大きく見えるはず（ハブが目立つ）。",
            "知見・洞察・話題・外部ソースの大きさは変えていない（種類ごとの固定値のまま）。",
            "配置は標準（layoutMode: plain）のまま。fcose の定数は変えていない。詰まって見えるかは目視で確認する。",
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
        initialLayoutMode="plain"
      />
    </Frame>
  ),
};

export const Islands: Story = {
  name: "4. 島（ノート中心、= 新しい既定）",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="foldLeaves: ON / sizeMode: reach / layoutMode: islands / focusLayer: note（GlobalGraphView の既定値そのもの）"
          points={[
            "データ自体が「島になりうる構造」: ノート 138 を 12 の試作シリーズ（各 8〜14 ノート）に分け、鎖・参照・知見の共有はシリーズの中を基本にする。シリーズをまたぐ参照は 12 本だけ。",
            "見るべきところ: 島はノート同士のつながりで決まる（ノート同士の辺だけでラベル伝播するので、複数ノートに共有された知見が橋になって島をくっつけない）。畳んだ知見・原料は所属ノートの周りに衛星として量感で見える。複数ノートに共有された知見・原料だけが通常サイズで島の中や島の間に立つ。",
            "島の輪郭が読めるか（どこまでが 1 つの島かが視覚的に分かるか）、試作シリーズの区切りと島がだいたい一致するかを見る。",
            "ヘッダーの層チップが「フォーカス」（島の中心にする種類）に変わっている。標準 (plain) に切り替えるとチップは表示/非表示のトグルに戻る。",
          ]}
        />
      }
    >
      <GlobalGraphView data={SAMPLE_DATA} onClose={noop} onSelectNote={noop} />
    </Frame>
  ),
};

export const FocusCrystal: Story = {
  name: "5. 知見にフォーカス",
  render: () => (
    <Frame
      note={
        <CaseNote
          title="foldLeaves: ON / sizeMode: reach / layoutMode: islands / focusLayer: crystal"
          points={[
            "島の中心は話題（topic）だけ。知見は数が多く（生成データで知見 700 件）、共有知見まで物理配置に混ぜても 1 つの塊になってしまったため、物理配置に参加するのは話題だけにした。話題どうしは、共有する知見の数が 1 以上のペアだけを射影の辺（不可視・自然長 110・弾性は共有数に比例）で繋ぐ。",
            "見るべきところ: 知見・洞察は幾何配置——隣接話題が 2 つ以上（共有知見）なら平均位置に size 30 の実ノードとして立つ（島の中や島の間）。隣接話題が 1 つなら衛星としてその話題のリングへ、話題を持たなければ隣接ノートの衛星になる。",
            "ノート・原料も幾何配置: ノートは隣接する（配置済みの）知見の平均位置、原料は隣接ノートの平均位置に、どちらも size 14 の小さな橋として立つ。",
            "話題の大きさは話題どうしの reach（2 ホップで届く他の話題の数）で 32〜64 に決まる。層チップの「原料」は選べない（原料中心の島はまだ用意していない）。",
          ]}
        />
      }
    >
      <GlobalGraphView
        data={SAMPLE_DATA}
        onClose={noop}
        onSelectNote={noop}
        initialFocusLayer="crystal"
      />
    </Frame>
  ),
};
