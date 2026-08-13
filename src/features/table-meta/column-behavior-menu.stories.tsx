// 列のはたらきメニューのストーリー（PR-B の合意用）
//
// 実テーブルに載せる前に、単体で見た目と言葉を確かめるためのもの。
// テーブルヘッダの上に浮くので、背景は表のヘッダ色に寄せて置いている。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import "../../app.css";
import { ColumnBehaviorIndicator, ColumnBehaviorMenu } from "./column-behavior-menu";
import type { ColumnType } from "./types";

const meta: Meta = {
  title: "Features/TableMeta/ColumnBehavior",
  parameters: { layout: "padded" },
};
export default meta;

/** 表のヘッダ行に見立てた台。メニューがどう重なるかを確かめる */
function TableHeaderStage({
  columns,
  children,
}: {
  columns: string[];
  children?: React.ReactNode;
}) {
  return (
    <div style={{ maxWidth: 620, padding: "8px 0 220px" }}>
      <table
        style={{
          borderCollapse: "collapse",
          fontSize: 14,
          color: "var(--color-foreground)",
        }}
      >
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                style={{
                  border: "1px solid var(--color-border-subtle)",
                  background: "var(--color-surface)",
                  padding: "8px 12px",
                  textAlign: "left",
                  fontWeight: 600,
                  minWidth: 120,
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {columns.map((c) => (
              <td
                key={c}
                style={{
                  border: "1px solid var(--color-border-subtle)",
                  padding: "8px 12px",
                }}
              >
                {c === "日時" ? "2026-08-14 09:30" : c === "名前" ? "A-1" : "—"}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {children}
    </div>
  );
}

function InteractiveMenu({
  columnName,
  initial,
  orphanColumnName,
}: {
  columnName: string;
  initial: ColumnType[];
  orphanColumnName?: string;
}) {
  const [behaviors, setBehaviors] = useState<ColumnType[]>(initial);
  const [orphan, setOrphan] = useState(orphanColumnName);
  return (
    <div style={{ marginTop: 10, display: "inline-block" }}>
      <ColumnBehaviorMenu
        columnName={columnName}
        behaviors={behaviors}
        orphanColumnName={orphan}
        onToggle={(type, next) =>
          setBehaviors((prev) =>
            next ? [...prev, type] : prev.filter((b) => b !== type)
          )
        }
        onReattachOrphan={() => {
          setBehaviors((prev) => (prev.includes("datetime-auto") ? prev : [...prev, "datetime-auto"]));
          setOrphan(undefined);
        }}
        onDropOrphan={() => setOrphan(undefined)}
      />
    </div>
  );
}

export const Empty: StoryObj = {
  name: "はたらきの付いていない列",
  render: () => (
    <TableHeaderStage columns={["項目", "値"]}>
      <InteractiveMenu columnName="項目" initial={[]} />
    </TableHeaderStage>
  ),
};

export const DatetimeOnly: StoryObj = {
  name: "日時が自動で入る列",
  render: () => (
    <TableHeaderStage columns={["日時", "値", "メモ"]}>
      <InteractiveMenu columnName="日時" initial={["datetime-auto"]} />
    </TableHeaderStage>
  ),
};

export const BothBehaviors: StoryObj = {
  name: "2 つのはたらきが同居する列",
  render: () => (
    <TableHeaderStage columns={["日時", "値"]}>
      <InteractiveMenu columnName="日時" initial={["datetime-auto", "note-link"]} />
    </TableHeaderStage>
  ),
};

export const Orphan: StoryObj = {
  name: "列名を書き換えて設定が迷子になった状態",
  render: () => (
    <TableHeaderStage columns={["測定時刻", "値"]}>
      <InteractiveMenu columnName="測定時刻" initial={[]} orphanColumnName="日時" />
    </TableHeaderStage>
  ),
};

export const Indicators: StoryObj = {
  name: "ヘッダに出る目印（4 状態）",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520 }}>
      {[
        { label: "はたらき無し（ホバー中だけ薄く出る）", behaviors: [] as ColumnType[], orphan: false },
        { label: "日時が自動で入る", behaviors: ["datetime-auto"] as ColumnType[], orphan: false },
        { label: "行からノートを作れる", behaviors: ["note-link"] as ColumnType[], orphan: false },
        { label: "両方 + 迷子の設定あり", behaviors: ["datetime-auto", "note-link"] as ColumnType[], orphan: true },
      ].map(({ label, behaviors, orphan }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              border: "1px solid var(--color-border-subtle)",
              background: "var(--color-surface)",
              padding: "8px 12px",
              minWidth: 150,
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-foreground)",
            }}
          >
            日時
            <ColumnBehaviorIndicator behaviors={behaviors} hasOrphan={orphan} onClick={() => {}} />
          </div>
          <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{label}</span>
        </div>
      ))}
    </div>
  ),
};
