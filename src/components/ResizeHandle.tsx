// パネル端のドラッグリサイズハンドル
// 使い方: position: relative なパネルの「直下の子」として置く
// （use-resizable-width が親要素の実測幅をドラッグ起点に読むため）。
// 普段は透明で、hover / ドラッグ中のみ中央の縦線をハイライトする。

import { useState } from "react";
import { createPortal } from "react-dom";
import type { ResizeHandleProps } from "../hooks/use-resizable-width";

export function ResizeHandle({
  handleProps,
  isResizing,
  label,
  edge = "left",
}: {
  handleProps: ResizeHandleProps;
  isResizing: boolean;
  /** ツールチップ + aria-label（操作説明: ドラッグで幅変更 / ダブルクリックで既定幅） */
  label: string;
  /** ハンドルを重ねるパネルの端 */
  edge?: "left" | "right";
}) {
  const [hovered, setHovered] = useState(false);
  const active = hovered || isResizing;

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        title={label}
        data-resize-handle
        {...handleProps}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "absolute",
          left: edge === "left" ? -3 : undefined,
          right: edge === "right" ? -3 : undefined,
          top: 0,
          bottom: 0,
          width: 7,
          cursor: "col-resize",
          // pointer events でドラッグするため、タッチのスクロールジェスチャを無効化
          touchAction: "none",
          zIndex: 30,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 2,
            height: "100%",
            background: "var(--color-primary)",
            opacity: active ? 0.5 : 0,
            transition: "opacity 0.15s",
          }}
        />
      </div>
      {/* ドラッグ中は全画面を透明レイヤで覆い、iframe（PDF ビューア等）に
          ポインタイベントを吸われないようにする */}
      {isResizing &&
        createPortal(
          <div style={{ position: "fixed", inset: 0, zIndex: 9999, cursor: "col-resize" }} />,
          document.body,
        )}
    </>
  );
}
