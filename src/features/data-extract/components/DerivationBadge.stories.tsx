// 由来のバッジのストーリー（ツールチップはバッジに載せたカーソルで確認）

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { TableDerivation } from "../types";
import { DerivationBadge } from "./DerivationBadge";

const meta: Meta<typeof DerivationBadge> = {
  title: "Features/DataExtract/DerivationBadge",
  component: DerivationBadge,
  decorators: [(Story) => <div className="p-6"><Story /></div>],
};
export default meta;

type Story = StoryObj<typeof DerivationBadge>;

const base: TableDerivation = {
  kind: "filter",
  fromFileName: "oven-curves.csv",
  columns: ["time", "temp_c", "dough"],
  conditions: [
    { column: "temp_c", op: "ge", value: "200" },
    { column: "dough", op: "eq", value: "baguette" },
  ],
  sourceRows: 233000,
  resultRows: 1204,
  createdAt: "2026-11-18T09:00:00.000Z",
};

export const Default: Story = { args: { derivation: base } };

/** 列を絞らず「含む」「空でない」だけ */
export const ConditionsOnly: Story = {
  args: {
    derivation: {
      ...base,
      columns: [],
      conditions: [
        { column: "note", op: "contains", value: "steam" },
        { column: "rise_mm", op: "notEmpty" },
      ],
    },
  },
};

/** ファイル名が長いとき。省略記号になる */
export const LongFileName: Story = {
  args: {
    derivation: {
      ...base,
      fromFileName: "oven-curves-2026-autumn-sourdough-trial-batch-12-all-sensors.csv",
    },
  },
};
