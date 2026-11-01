// MemoQuoteLayer のストーリー
// 紐づいた引用ブロックの見せ方。左の縦線がメモの色（黄土系）になり、ブロックにマウスを載せると
// 右上の内側に印が出る。元のメモが更新されていれば印に小さな点が付く。
// 実際のエディタの代わりに、BlockNote の引用ブロックと同じ DOM を並べて確かめる
// （層は DOM と紐づけだけを見る）。紐づいていない引用ブロックは普通の灰色の縦線のまま。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { MemoQuoteLayer } from "./MemoQuoteLayer";
import { MemoQuoteProvider, useMemoQuoteStore } from "./store";
import type { MemoQuoteRef } from "../../lib/document-types";
import type { CaptureIndex } from "../mobile-capture";
import "../../app.css";

const meta: Meta = {
  title: "Memo Quote / MemoQuoteLayer",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "紐づいた引用ブロックの縦線と印。印はマウスが載っている間・選択中だけ出る。押すと小窓（元のメモ・更新の反映・紐づけを外す）。",
      },
    },
  },
};
export default meta;
type Story = StoryObj;

const ref = (captureId: string, quotedText: string): MemoQuoteRef => ({
  captureId,
  quotedAt: "2026-10-30T11:05:00.000Z",
  quotedText,
});

const CAPTURES: CaptureIndex = {
  version: 1,
  updatedAt: "2026-10-30T12:00:00.000Z",
  captures: [
    { id: "c1", text: "粒界に析出物が見える。", createdAt: "2026-10-30T10:00:00.000Z" },
    {
      id: "c2",
      text: "x10000 を撮り直す。EDS も追加する。",
      createdAt: "2026-10-30T10:10:00.000Z",
    },
  ],
};

// 引用ブロックの見た目は BlockNote の標準（左 2px の灰色の線）と同じ
const quoteStyle = {
  borderLeft: "2px solid rgb(125, 121, 122)",
  color: "rgb(125, 121, 122)",
  margin: 0,
  paddingLeft: "1em",
} as const;

function Seed({ snapshot }: { snapshot: Record<string, MemoQuoteRef> }) {
  const store = useMemoQuoteStore();
  useEffect(() => {
    store.restoreSnapshot(snapshot);
    // 一度だけ流し込む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function Demo() {
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
  const blocks = [
    { id: "intro", type: "paragraph", text: "SEM で観察した。" },
    { id: "q-synced", type: "quote", text: "粒界に析出物が見える。" },
    { id: "q-updated", type: "quote", text: "x10000 を撮り直す。" },
    { id: "q-plain", type: "quote", text: "メモとは紐づいていない普通の引用ブロック。" },
  ];
  return (
    <MemoQuoteProvider>
      <Seed
        snapshot={{
          "q-synced": ref("c1", "粒界に析出物が見える。"),
          // 引用したときの本文と今のメモが違う → 印に点
          "q-updated": ref("c2", "x10000 を撮り直す。"),
        }}
      />
      <div ref={setWrapper} style={{ position: "relative", width: 560, padding: 16 }}>
        {blocks.map((b) => (
          <div key={b.id} data-node-type="blockOuter" data-id={b.id} style={{ margin: "8px 0" }}>
            <div className="bn-block">
              <div className="bn-block-content" data-content-type={b.type}>
                {b.type === "quote" ? <blockquote style={quoteStyle}>{b.text}</blockquote> : <p style={{ margin: 0 }}>{b.text}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <MemoQuoteLayer
        editor={null}
        wrapperEl={wrapper}
        captureIndex={CAPTURES}
        editable
        onOpenMemo={(id) => console.log("open memo", id)}
      />
    </MemoQuoteProvider>
  );
}

/** 3 つの引用ブロック: 引用時のまま／元のメモが更新されている／紐づいていない。マウスを載せてみてください */
export const Default: Story = { render: () => <Demo /> };
