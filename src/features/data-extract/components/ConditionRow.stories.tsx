// 条件の 1 行のストーリー
// 数値の列と文字の列で演算子の候補が変わること、種類の少ない列で値の候補が出ることを確かめる。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ExtractCondition } from "../types";
import { ConditionRow } from "./ConditionRow";
import { BREAD_PROFILES } from "./sample-data";

const meta: Meta<typeof ConditionRow> = {
  title: "Features/DataExtract/ConditionRow",
  component: ConditionRow,
};
export default meta;

type Story = StoryObj<typeof ConditionRow>;

function Controlled({ initial }: { initial: ExtractCondition }) {
  const [cond, setCond] = useState(initial);
  return (
    <div className="p-4 flex flex-col gap-3">
      <ConditionRow
        columns={BREAD_PROFILES}
        condition={cond}
        onChange={setCond}
        onRemove={() => setCond({ column: "", op: "eq" })}
      />
      <pre className="text-[11px] text-muted-foreground">{JSON.stringify(cond)}</pre>
    </div>
  );
}

/** 数値の列。= ≠ > ≥ < ≤ 空でない */
export const NumberColumn: Story = {
  render: () => <Controlled initial={{ column: "temp_c", op: "ge", value: "200" }} />,
};

/** 文字の列。= ≠ 含む 空でない */
export const TextColumn: Story = {
  render: () => <Controlled initial={{ column: "note", op: "contains", value: "ok" }} />,
};

/** 種類の少ない列の「=」。値の欄に候補が出る（欄をクリック） */
export const WithCandidates: Story = {
  render: () => <Controlled initial={{ column: "dough", op: "eq", value: "" }} />,
};

/** 「空でない」は値の欄が消える */
export const NotEmpty: Story = {
  render: () => <Controlled initial={{ column: "note", op: "notEmpty" }} />,
};
