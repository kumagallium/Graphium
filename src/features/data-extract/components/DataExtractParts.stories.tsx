// 3 つの部品を縦に並べて見る story。ダイアログの形ではない（枠・見出し・確定ボタンは付けない）。
// 部品どうしの余白と文字の釣り合いを見るためのもの。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import { applyExtract, isActiveCondition } from "../apply";
import type { ExtractCondition } from "../types";
import { ColumnChooser } from "./ColumnChooser";
import { ConditionRow } from "./ConditionRow";
import { ExtractSummary } from "./ExtractSummary";
import { BREAD_HEADERS, BREAD_PROFILES, BREAD_ROWS } from "./sample-data";

function Parts() {
  const [columns, setColumns] = useState<string[]>(["time", "temp_c", "dough"]);
  const [conds, setConds] = useState<ExtractCondition[]>([
    { column: "temp_c", op: "ge", value: "200" },
    { column: "dough", op: "eq", value: "baguette" },
  ]);
  const spec = useMemo(() => ({ columns, conditions: conds }), [columns, conds]);
  const result = useMemo(() => applyExtract(BREAD_HEADERS, BREAD_ROWS, spec), [spec]);
  const sameAsSource =
    !conds.some(isActiveCondition) &&
    (columns.length === 0 || columns.length === BREAD_HEADERS.length);
  return (
    <div className="p-4 flex flex-col gap-4 w-[480px]">
      <ColumnChooser columns={BREAD_PROFILES} selected={columns} onChange={setColumns} />
      <div className="flex flex-col gap-1.5">
        {conds.map((c, i) => (
          <ConditionRow
            key={i}
            columns={BREAD_PROFILES}
            condition={c}
            onChange={(next) => setConds((cur) => cur.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setConds((cur) => cur.filter((_, j) => j !== i))}
          />
        ))}
      </div>
      <ExtractSummary
        sourceRows={result.sourceRows}
        resultRows={result.rows.length}
        columnCount={result.headers.length}
        sameAsSource={sameAsSource}
      />
    </div>
  );
}

const meta: Meta<typeof Parts> = {
  title: "Features/DataExtract/並べて見る",
  component: Parts,
};
export default meta;

export const Together: StoryObj<typeof Parts> = {};
