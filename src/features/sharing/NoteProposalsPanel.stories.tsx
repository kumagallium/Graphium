// NoteProposalsPanel — ノート編集画面（元の作者側）の右パネル「提案」タブ
//
// 何を見る場所か:
//   自分が共有したノートに来た「変更の提案」を読み、チェックした変更だけを
//   手元のノートへ取り込む。ここでは選択の既定と、競合があるときの見え方を確かめる。
//
// 見どころ:
//   - 既定で選ばれるのは「提案者」だけが変えたもの。競合（両方）は未選択
//   - 元の作者が変えた項目はチェックボックスが無く、作者から見た向きの文言で出る
//     （自分が足した行が「削除」と読めない）
//   - 表は既定でセル単位。ブロック側のチェックを入れると表を丸ごと置き換える
//
// 共有フォルダは Tauri の invoke 越しなので、Storybook では封筒・本文・基準版を
// すべて props（DI）で渡す。取り込みは console に出すだけで何も保存しない。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import type { GraphiumDocument } from "../../lib/document-types";
import type { BlobRef, SharedEntry } from "../../lib/storage/shared";
import { NoteProposalsPanel } from "./NoteProposalsPanel";
import "../../app.css";

const OWNER = { name: "山田 先生", email: "yamada@example.ac.jp" };
const PROPOSER = { name: "佐藤 学生", email: "sato@example.ac.jp" };
const PROPOSER2 = { name: "鈴木 学生", email: "suzuki@example.ac.jp" };

const TARGET_ID = "note-shared-1";
const TARGET_HASH = "sha256:v2-current";

const BASE_REF: BlobRef = {
  provider: "local-folder",
  uri: "file:///blobs/base.json",
  hash: "sha256:base-1",
  size: 512,
  filename: "base.json",
};

function paragraph(id: string, text: string) {
  return {
    id,
    type: "paragraph",
    props: {},
    content: [{ type: "text", text, styles: {} }],
    children: [],
  };
}

function table(id: string, rows: string[][]) {
  return {
    id,
    type: "table",
    props: {},
    content: {
      type: "tableContent",
      rows: rows.map((cells) => ({
        cells: cells.map((text) => ({
          type: "tableCell",
          props: {},
          content: text ? [{ type: "text", text, styles: {} }] : [],
        })),
      })),
    },
    children: [],
  };
}

function doc(blocks: unknown[], title: string): GraphiumDocument {
  return {
    version: 5,
    title,
    pages: [{ id: "main", title, blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-09-01T00:00:00Z",
    modifiedAt: "2026-09-02T00:00:00Z",
  } as unknown as GraphiumDocument;
}

// ── 3 者比較の材料（パン作りの記録）──
const TITLE = "全粒粉パンの記録";

/** 派生した時点の版 */
const BASE_DOC = doc(
  [
    paragraph("b-1", "強力粉 200 g、全粒粉 50 g、水 170 g、塩 5 g。"),
    paragraph("b-2", "オーブンは 220 ℃ に予熱する。"),
    table("b-t", [
      ["工程", "時間", "温度"],
      ["一次発酵", "60 分", "28 ℃"],
      ["二次発酵", "40 分", "30 ℃"],
    ]),
  ],
  TITLE,
);

/** 提案（提案者が直したもの）: 予熱温度とオーブン時間、表の 1 マス、末尾に注意書き */
const THEIRS_DOC = doc(
  [
    paragraph("b-1", "強力粉 200 g、全粒粉 50 g、水 170 g、塩 5 g。"),
    paragraph("b-2", "オーブンは 240 ℃ に予熱する（うちの窯は表示より 20 ℃ 低い）。"),
    table("b-t", [
      ["工程", "時間", "温度"],
      ["一次発酵", "90 分", "28 ℃"],
      ["二次発酵", "40 分", "30 ℃"],
    ]),
    paragraph("b-new", "焼く前に霧吹きで水をかけると皮が薄くなる。"),
  ],
  TITLE,
);

/** 元の作者の手元の本文: 基準版に自分で 1 段落足しただけ（競合なし） */
const MINE_DOC = doc(
  [
    paragraph("b-1", "強力粉 200 g、全粒粉 50 g、水 170 g、塩 5 g。"),
    paragraph("b-2", "オーブンは 220 ℃ に予熱する。"),
    table("b-t", [
      ["工程", "時間", "温度"],
      ["一次発酵", "60 分", "28 ℃"],
      ["二次発酵", "40 分", "30 ℃"],
    ]),
    paragraph("b-mine", "粉は前日に冷蔵庫から出しておく。"),
  ],
  TITLE,
);

/** 競合あり: 元の作者も同じ段落と同じマスを直していた */
const MINE_CONFLICT_DOC = doc(
  [
    paragraph("b-1", "強力粉 200 g、全粒粉 50 g、水 170 g、塩 5 g。"),
    paragraph("b-2", "オーブンは 230 ℃ に予熱する。"),
    table("b-t", [
      ["工程", "時間", "温度"],
      ["一次発酵", "75 分", "28 ℃"],
      ["二次発酵", "40 分", "30 ℃"],
    ]),
  ],
  TITLE,
);

const TARGET_ENTRY: SharedEntry = {
  id: TARGET_ID,
  type: "note",
  author: OWNER,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-02T00:00:00Z",
  hash: TARGET_HASH,
  prov: { derived_from: [] },
  extra: { title: TITLE },
} as SharedEntry;

function proposal(
  id: string,
  author: { name: string; email: string },
  title: string,
  message: string,
  updatedAt: string,
): SharedEntry {
  return {
    id,
    type: "proposal",
    author,
    created_at: updatedAt,
    updated_at: updatedAt,
    hash: `sha256:${id}`,
    prov: { derived_from: [TARGET_ID] },
    extra: {
      title,
      target: TARGET_ID,
      targetHash: TARGET_HASH,
      targetTitle: TITLE,
      message,
      baseRef: BASE_REF,
    },
  } as SharedEntry;
}

const PROPOSALS: SharedEntry[] = [
  proposal(
    "prop-1",
    PROPOSER,
    "予熱温度と一次発酵の時間",
    "うちの窯だと 220 ℃ では焼き色が付かなかったので直しました。",
    "2026-09-03T09:00:00Z",
  ),
  proposal(
    "prop-2",
    PROPOSER2,
    "水分量のメモ",
    "湿度が高い日の水の量について 1 行だけ。",
    "2026-09-04T11:30:00Z",
  ),
];

const readBody = async () => ({
  body: new TextEncoder().encode(JSON.stringify(THEIRS_DOC)),
  verified: true,
});

const readBlob = async () => new TextEncoder().encode(JSON.stringify(BASE_DOC));

const meta: Meta<typeof NoteProposalsPanel> = {
  title: "Sharing/NoteProposalsPanel",
  component: NoteProposalsPanel,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "元の作者の右パネル「提案」タブ。一覧から 1 件選ぶと差分が出て、チェックした変更だけを手元のノートへ取り込む。既定で選ばれるのは「提案者だけが変えた」項目で、競合（両方が変えた）は自分で判断して入れる。元の作者が変えた項目はチェックボックスを出さず、作者から見た向きの文言で出す。取り込む前には版が自動で 1 つ残る。",
      },
    },
  },
  args: {
    targetId: TARGET_ID,
    targetHash: TARGET_HASH,
    entries: [TARGET_ENTRY, ...PROPOSALS],
    resolveMine: async () => MINE_DOC,
    readBody,
    readBlob,
    onAdopt: async (request) => {
      console.log("[storybook] adopt", request.proposalId, [...request.selected]);
      return { applied: request.selected.size, skipped: [] };
    },
    onHighlightBlock: (blockId: string | null) =>
      console.log("[storybook] highlight block", blockId),
    onOpenProposalFull: (id: string) => console.log("[storybook] open full", id),
  },
  decorators: [
    (Story) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          {/* 実際の置き場所（右パネル）と同じ幅・高さで見る */}
          <div
            style={{
              width: 420,
              height: 560,
              display: "flex",
              flexDirection: "column",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: 8,
              overflow: "hidden",
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj<typeof NoteProposalsPanel>;

/** 一覧（2 件来ている状態）。1 件押すと差分に降りる */
export const Playground: Story = {
  name: "変更の提案 — 一覧",
};

/**
 * 取り込みの既定の選択。
 * 提案者が変えた 3 項目（段落・表のマス・追加された段落）にチェックが入り、
 * 元の作者が足した段落にはチェックボックスが出ない。
 */
export const AdoptDefaults: Story = {
  name: "変更の提案 — 取り込む（既定の選択）",
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLElement>(
      '[data-testid="note-proposal-row-prop-1"]',
    );
    row?.click();
  },
};

/**
 * 競合あり。元の作者も同じ段落・同じマスを直していたので「両方」になり、
 * 既定では選ばれない（どちらを採るかは人が決める）。
 */
export const AdoptWithConflicts: Story = {
  name: "変更の提案 — 取り込む（競合あり）",
  args: { resolveMine: async () => MINE_CONFLICT_DOC },
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLElement>(
      '[data-testid="note-proposal-row-prop-1"]',
    );
    row?.click();
  },
};

/** まだ 1 件も来ていないノート */
export const Empty: Story = {
  name: "提案なし",
  args: { entries: [TARGET_ENTRY] },
};

/** 英語表示 */
export const English: Story = {
  name: "English",
  decorators: [
    (Story) => {
      syncLocale("en");
      return (
        <LocaleProvider>
          <div
            style={{
              width: 420,
              height: 560,
              display: "flex",
              flexDirection: "column",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: 8,
              overflow: "hidden",
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLElement>(
      '[data-testid="note-proposal-row-prop-1"]',
    );
    row?.click();
  },
};
