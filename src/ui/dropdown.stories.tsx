// Dropdown + MenuItem Molecule — フローティングパネルのカタログ

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Dropdown, DropdownSectionHeader, DropdownDivider } from "./dropdown";
import { MenuItem } from "./menu-item";
import { Button } from "./button";

const meta: Meta<typeof Dropdown> = {
  title: "Molecules/Dropdown",
  component: Dropdown,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof Dropdown>;

export const Basic: Story = {
  name: "基本",
  render: () => {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });

    return (
      <>
        <Button
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setPos({ top: rect.bottom + 4, left: rect.left });
            setOpen(!open);
          }}
        >
          ドロップダウンを開く
        </Button>
        {open && (
          <Dropdown position={pos} onClose={() => setOpen(false)}>
            <div className="py-1.5">
              <MenuItem onClick={() => setOpen(false)}>項目 1</MenuItem>
              <MenuItem onClick={() => setOpen(false)}>項目 2</MenuItem>
              <MenuItem onClick={() => setOpen(false)}>項目 3</MenuItem>
            </div>
          </Dropdown>
        )}
      </>
    );
  },
};

export const WithSections: Story = {
  name: "セクション付き",
  render: () => {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const [selected, setSelected] = useState<string | null>("[手順]");

    const labels = [
      { name: "[手順]", color: "#5b8fb9" },
      { name: "[使用したもの]", color: "#4B7A52" },
      { name: "[属性]", color: "#c08b3e" },
      { name: "[試料]", color: "#8b7ab5" },
      { name: "[結果]", color: "#c26356" },
    ];

    return (
      <>
        <Button
          variant="outline"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setPos({ top: rect.bottom + 4, left: rect.left });
            setOpen(!open);
          }}
        >
          ラベル選択: {selected ?? "なし"}
        </Button>
        {open && (
          <Dropdown position={pos} onClose={() => setOpen(false)} minWidth={220}>
            <div className="py-1.5">
              <DropdownSectionHeader>コアラベル（PROV-DM）</DropdownSectionHeader>
              {labels.map((l) => (
                <MenuItem
                  key={l.name}
                  active={selected === l.name}
                  dotColor={l.color}
                  onClick={() => {
                    setSelected(selected === l.name ? null : l.name);
                    setOpen(false);
                  }}
                >
                  {l.name}
                </MenuItem>
              ))}

              <DropdownDivider />

              <DropdownSectionHeader>操作</DropdownSectionHeader>
              <MenuItem
                onClick={() => {
                  setSelected(null);
                  setOpen(false);
                }}
                className="text-destructive"
              >
                ラベルを外す
              </MenuItem>
            </div>
          </Dropdown>
        )}
      </>
    );
  },
};
