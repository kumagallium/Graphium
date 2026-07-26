// ImageOcrToolbarButton — 画像を選んだときのツールバーに出る OCR ボタン
//
// 画像ブロックを選択すると出る BlockNote のツールバー（Edit caption / Replace image …）
// の末尾に並ぶ。ドラッグハンドルのメニュー内だけだと入口が見つけづらいため、
// 画像をクリックすれば必ず目に入るここを主導線にしている。
//
// サイズは周囲の BlockNote 標準ボタンに合わせて 36px 角・rounded-md。

import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ImageOcrToolbarButton } from "./ImageOcrToolbarButton";
import { MediaOcrProvider, useMediaOcrStore } from "./store";
import type { MediaOcrEntry } from "../../lib/document-types";

const BLOCK_ID = "demo-block";

/** ストアに読み取り済みの結果を仕込む（読み取り済み状態の再現用） */
function SeedEntry({ entry }: { entry: MediaOcrEntry | null }) {
  const store = useMediaOcrStore();
  useEffect(() => {
    store.setEntry(BLOCK_ID, entry);
    // 初回のみ仕込む（以降はボタン操作でストアが変わる）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** 周囲の標準ボタンと並べて、寸法が揃っているかを見るための枠 */
function ToolbarFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-sm">
      {/* 標準ボタン相当のダミー（36px 角） */}
      {["A", "¶", "⋯"].map((label) => (
        <button
          key={label}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5"
        >
          {label}
        </button>
      ))}
      {children}
    </div>
  );
}

function Demo({ entry }: { entry: MediaOcrEntry | null }) {
  return (
    <MediaOcrProvider>
      <SeedEntry entry={entry} />
      <div className="p-6 space-y-3">
        <p className="text-xs text-muted-foreground max-w-md">
          ダミーの標準ボタン（A / ¶ / ⋯）と並べています。OCR ボタンだけ幅が細いと
          「詰まって見える」ため、36px 角・rounded-md で揃えているかを確認します。
        </p>
        <ToolbarFrame>
          <ImageOcrToolbarButton blockId={BLOCK_ID} imageUrl="https://example.invalid/sample.png" />
        </ToolbarFrame>
      </div>
    </MediaOcrProvider>
  );
}

const meta: Meta<typeof ImageOcrToolbarButton> = {
  title: "Molecules/ImageOcrToolbarButton",
  component: ImageOcrToolbarButton,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof ImageOcrToolbarButton>;

/**
 * まだ読み取っていない画像 — 押すと OCR が走る。
 * （このストーリーの画像 URL はダミーなので、押しても結果は返らない）
 */
export const NotReadYet: Story = {
  render: () => <Demo entry={null} />,
};

/**
 * 読み取り済み — アイコンが変わり、押すと抽出テキストのパネルが開く。
 * ツールチップには文字数が出る。
 */
export const AlreadyRead: Story = {
  render: () => (
    <Demo
      entry={{
        text: "案A レール（縦線のみ・現況）\n反応 A を実施する\n試薬を混合し 60°C で 30 分撹拌した。\nNaCl 5 g 特級\n水 100 mL 脱イオン\nyield = 0.87",
        confidence: 88,
        lang: "jpn+eng",
        extractedAt: "2026-07-26T02:53:47.938Z",
      }}
    />
  ),
};

/** 長文を読み取った場合 — パネル内はスクロールし、ツールバー側は文字数だけ出す */
export const LongText: Story = {
  render: () => (
    <Demo
      entry={{
        text: Array.from({ length: 40 }, (_, i) => `${i + 1} 行目の抽出テキストのサンプルです。`).join("\n"),
        confidence: 76,
        lang: "jpn+eng",
        extractedAt: "2026-07-26T02:53:47.938Z",
      }}
    />
  ),
};
