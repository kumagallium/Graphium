// ThingGroupsSection（手入れ画面の「もの単位にまとめる」の節）のストーリー。
// 閉じた状態・開いた状態・1 組を選んだ状態・実行中・一部失敗・AI 未設定を単独で確認する。
// 操作は console.info を鳴らすだけ（実際のまとめは行わない）。デモデータはパン作りの世界観。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider, syncLocale } from "../../i18n";
import { ThingGroupsSection, type ThingGroupResult } from "./ThingGroupsSection";
import type { ThingGroup } from "./thing-groups";
import "../../app.css";

const meta: Meta = {
  title: "Molecules/ThingGroupsSection",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "手入れ画面の下のほうの折りたたみの節。同じものについてのページが性質ごとに分かれている組を並べ、押したときだけ 1 ページにまとめる（AI を使うのは「まとめる」を押したあと。組分け自体は題の形だけで決める）。組が 0 件のときは節ごと出さない。",
      },
    },
  },
  decorators: [
    (Story) => {
      syncLocale("ja");
      return (
        <LocaleProvider>
          <div style={{ maxWidth: 720, background: "var(--paper-2)" }}>
            <Story />
          </div>
        </LocaleProvider>
      );
    },
  ],
};
export default meta;

type Story = StoryObj;

const groups: ThingGroup[] = [
  {
    thing: "全粒粉",
    keepId: "k-whole",
    retitle: false,
    absorbIds: Array.from({ length: 12 }, (_, i) => `a-whole-${i}`),
    sections: [{ id: "k-whole", heading: null }, ...Array.from({ length: 12 }, (_, i) => ({ id: `a-whole-${i}`, heading: `性質${i + 1}` }))],
    memberTitles: [
      "全粒粉の吸水", "全粒粉の灰分", "全粒粉の酵素活性", "全粒粉の保存", "全粒粉の挽き方", "全粒粉の香り",
      "全粒粉の配合比", "全粒粉の産地", "全粒粉の色", "全粒粉のふすまの量", "全粒粉の粒度", "全粒粉の価格",
    ],
  },
  {
    thing: "ライ麦サワー種",
    keepId: "k-rye",
    retitle: true,
    absorbIds: ["a-rye-1", "a-rye-2", "a-rye-3"],
    sections: [{ id: "k-rye", heading: "発酵時間" }, { id: "a-rye-1", heading: "酸度" }, { id: "a-rye-2", heading: "加水率" }, { id: "a-rye-3", heading: "保存温度" }],
    memberTitles: ["ライ麦サワー種の発酵時間", "ライ麦サワー種の酸度", "ライ麦サワー種の加水率", "ライ麦サワー種の保存温度"],
  },
  {
    thing: "石窯オーブン",
    keepId: "k-oven",
    retitle: true,
    absorbIds: ["a-oven-1"],
    sections: [{ id: "k-oven", heading: "予熱時間" }, { id: "a-oven-1", heading: "蓄熱" }],
    memberTitles: ["石窯オーブンの予熱時間", "石窯オーブンの蓄熱"],
  },
];

const mockMerge = async (target: ThingGroup[], hooks?: { onGroupStart?: (id: string) => void; onGroupDone?: (id: string, ok: boolean) => void }): Promise<ThingGroupResult[]> => {
  console.info("[story] merge", target.map((g) => g.thing));
  const results: ThingGroupResult[] = [];
  for (const g of target) {
    hooks?.onGroupStart?.(g.keepId);
    await new Promise((r) => setTimeout(r, 800));
    results.push({ keepId: g.keepId, ok: true });
    hooks?.onGroupDone?.(g.keepId, true);
  }
  return results;
};

export const Closed: Story = {
  name: "閉じた状態（既定）",
  render: () => <ThingGroupsSection groups={groups} onMerge={mockMerge} />,
};

export const Open: Story = {
  name: "開いた状態（3 組）",
  render: () => <ThingGroupsSection groups={groups} onMerge={mockMerge} defaultOpen />,
};

export const OneSelected: Story = {
  name: "1 組を選んだ状態",
  render: () => <ThingGroupsSection groups={groups} onMerge={mockMerge} defaultOpen defaultSelected={["k-rye"]} />,
};

export const Running: Story = {
  name: "実行中",
  render: () => (
    <ThingGroupsSection groups={groups} onMerge={mockMerge} defaultOpen defaultSelected={["k-rye", "k-oven"]} previewRunningId="k-rye" />
  ),
};

export const PartlyFailed: Story = {
  name: "一部失敗",
  render: () => <ThingGroupsSection groups={groups} onMerge={mockMerge} defaultOpen previewFailedIds={["k-oven"]} />,
};
