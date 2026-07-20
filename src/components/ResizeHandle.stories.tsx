// ResizeHandle — パネル端のドラッグリサイズハンドルのカタログ
// SidePeek（右側パネル）での利用を想定した実働デモ。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ResizeHandle } from "./ResizeHandle";
import { useResizableWidth } from "../hooks/use-resizable-width";

const meta: Meta<typeof ResizeHandle> = {
  title: "Atoms/ResizeHandle",
  component: ResizeHandle,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof ResizeHandle>;

function RightPanelDemo() {
  const { width, widthStyle, isResizing, handleProps } = useResizableWidth({
    storageKey: "storybook-resize-demo",
    min: 240,
    max: 640,
    viewportReserve: 200,
  });

  return (
    <div style={{ display: "flex", height: 400, background: "var(--color-background)" }}>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-tertiary)",
          fontSize: 13,
        }}
      >
        メインコンテンツ（残り幅）
      </div>
      <div
        style={{
          position: "relative",
          flexShrink: 0,
          width: widthStyle ?? 320,
          borderLeft: "1px solid var(--color-border-subtle)",
          background: "var(--color-card)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          color: "var(--color-text-secondary)",
          fontSize: 13,
        }}
      >
        <ResizeHandle
          handleProps={handleProps}
          isResizing={isResizing}
          label="ドラッグで幅を変更 / ダブルクリックで既定幅に戻す"
        />
        <span>右パネル（SidePeek 型）</span>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          {width == null ? "既定幅（未カスタム）" : `カスタム幅: ${width}px`}
        </span>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          左端をドラッグ / ダブルクリックでリセット
        </span>
      </div>
    </div>
  );
}

export const RightPanel: Story = {
  name: "右パネル（実働デモ）",
  render: () => <RightPanelDemo />,
};
