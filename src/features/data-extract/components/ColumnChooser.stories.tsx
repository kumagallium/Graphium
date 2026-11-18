// 列の選択のストーリー

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ColumnProfile } from "../types";
import { ColumnChooser } from "./ColumnChooser";
import { BREAD_PROFILES, WIDE_PROFILES } from "./sample-data";

const meta: Meta<typeof ColumnChooser> = {
  title: "Features/DataExtract/ColumnChooser",
  component: ColumnChooser,
};
export default meta;

type Story = StoryObj<typeof ColumnChooser>;

function Controlled({ columns, initial }: { columns: ColumnProfile[]; initial: string[] }) {
  const [selected, setSelected] = useState(initial);
  return (
    <div className="p-4 w-72">
      <ColumnChooser columns={columns} selected={selected} onChange={setSelected} />
    </div>
  );
}

/** 一部だけ選んだ状態 */
export const Some: Story = {
  render: () => <Controlled columns={BREAD_PROFILES} initial={["time", "temp_c"]} />,
};

/** すべて選んだ状態 */
export const AllSelected: Story = {
  render: () => <Controlled columns={BREAD_PROFILES} initial={BREAD_PROFILES.map((c) => c.name)} />,
};

/** 20 列以上。高さを決めて中でスクロールする */
export const ManyColumns: Story = {
  render: () => <Controlled columns={WIDE_PROFILES} initial={["time"]} />,
};
