// 機能のオン・オフ 1 行のストーリー。
// 説明を畳んだとき、トグルの名前と 1 行だけで判断できるかを見る。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SettingToggle } from "./SettingToggle";

const meta = {
  title: "Molecules/SettingToggle",
  component: SettingToggle,
  parameters: { layout: "padded" },
} satisfies Meta<typeof SettingToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness(props: { label: string; summary: string; details: string; initial?: boolean }) {
  const [on, setOn] = useState(props.initial ?? false);
  return (
    <SettingToggle
      checked={on}
      onChange={() => setOn((v) => !v)}
      label={props.label}
      summary={props.summary}
      details={<p>{props.details}</p>}
    />
  );
}

/** AI タブの「世界照合を使う」。実際の文言で組んである。 */
export const WorldGrounding: Story = {
  args: { checked: false, onChange: () => {}, label: "" },
  render: () => (
    <Harness
      label="世界照合を使う"
      summary="書いたことが世の中で知られていることと合うかを確かめます。"
      details="世界照合は賢いモデルほど判定の質が上がります。オフにすると、照合のボタンと列が隠れます。照合済みの結果は残ります。"
    />
  ),
};

/** 説明が長い設定ほど効く。既定オフのものはその旨を要約に入れる。 */
export const AutoGrounding: Story = {
  args: { checked: false, onChange: () => {}, label: "" },
  render: () => (
    <Harness
      label="自動で世界照合する"
      summary="新しくできた洞察・知見を、裏で 1 件ずつ自動で照合します（既定はオフ）。"
      details="まず KB を見て、未登録の主張だけモデル判定するので、使うほど KB が育ち照合は速く・安くなります。同じ世界事実に接続した洞察どうしが自動でつながります。"
    />
  ),
};

/** オンのときだけ出る設定を下にぶら下げた形。 */
export const WithNestedControl: Story = {
  args: { checked: true, onChange: () => {}, label: "" },
  render: () => {
    return (
      <SettingToggle
        checked
        onChange={() => {}}
        label="洞察を使う"
        summary="ノートをまたいで繰り返し出てくる型を見つけます。"
        details={<p>洞察は賢いモデルほど質が上がります。オフにすると、サイドバーと一覧から隠れます。作成済みの洞察は残ります。</p>}
      >
        <p className="text-xs text-muted-foreground">（オンのときだけ出る設定がここに入る）</p>
      </SettingToggle>
    );
  },
};
