// パネル端のドラッグリサイズハンドル
// 使い方: position: relative なパネルの「直下の子」として置く
// （use-resizable-width / -height が親要素の実測サイズをドラッグ起点に読むため）。
// 普段は透明で、hover / ドラッグ中のみ中央の線をハイライトする。
// edge が left / right なら縦線（幅リサイズ）、top / bottom なら横線（高さリサイズ）。

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
  /** ツールチップ + aria-label（操作説明: ドラッグでサイズ変更 / ダブルクリックで既定） */
  label: string;
  /** ハンドルを重ねるパネルの端 */
  edge?: "left" | "right" | "top" | "bottom";
}) {
  const [hovered, setHovered] = useState(false);
  const active = hovered || isResizing;
  const horizontal = edge === "top" || edge === "bottom";
  const cursor = horizontal ? "row-resize" : "col-resize";

  return (
    <>
      <div
        role="separator"
        // separator の aria-orientation は「区切り線自体の向き」: 横線 = horizontal
        aria-orientation={horizontal ? "horizontal" : "vertical"}
        aria-label={label}
        title={label}
        data-resize-handle
        {...handleProps}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "absolute",
          left: edge === "left" ? -3 : horizontal ? 0 : undefined,
          right: edge === "right" ? -3 : horizontal ? 0 : undefined,
          top: edge === "top" ? -3 : horizontal ? undefined : 0,
          bottom: edge === "bottom" ? -3 : horizontal ? undefined : 0,
          width: horizontal ? undefined : 7,
          height: horizontal ? 7 : undefined,
          cursor,
          // pointer events でドラッグするため、タッチのスクロールジェスチャを無効化
          touchAction: "none",
          zIndex: 30,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: horizontal ? "100%" : 2,
            height: horizontal ? 2 : "100%",
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
          <div style={{ position: "fixed", inset: 0, zIndex: 9999, cursor }} />,
          document.body,
        )}
    </>
  );
}
