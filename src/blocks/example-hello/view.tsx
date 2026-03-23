import { createReactBlockSpec } from "@blocknote/react";

// サンプル：最小構成のカスタムブロック
// 新しいブロックを作るときのテンプレートとして使う
export const HelloBlock = createReactBlockSpec(
  {
    type: "hello" as const,
    propSchema: {
      name: { default: "World" },
    },
    content: "none" as const,
  },
  {
    render: (props) => {
      const { name } = props.block.props;
      return (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            background: "#f0f9ff",
            border: "1px solid #bae6fd",
            fontSize: 14,
          }}
        >
          Hello, <strong>{name}</strong>!
          <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>
            これはサンプルのカスタムブロックです
          </div>
        </div>
      );
    },
  }
);
