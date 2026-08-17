// LexicalIndexCard（設定 → ストレージ の「検索インデックス」カード）のビジュアル確認用ストーリー。
// サービスの状態（未ロード / 索引済み / 更新中）ごとの見え方と、再構築ボタンの活性を確認する。
// サービスはシングルトンなので、ストーリーごとに状態を注入して描画する。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { LocaleProvider } from "@/i18n";
import { LexicalIndexCard } from "./LexicalIndexCard";
import { lexicalSearch } from "./service";
import type { GraphiumDocument } from "../../lib/document-types";

const meta: Meta<typeof LexicalIndexCard> = {
  title: "Molecules/LexicalIndexCard",
  component: LexicalIndexCard,
  parameters: {
    docs: {
      description: {
        component:
          "ノート本文・ナレッジ・素材テキストの語彙インデックス（BM25）の状態表示と再構築。索引は端末ローカルの再構築可能なキャッシュで、ノートデータには書き込まない。",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof LexicalIndexCard>;

const doc = (title: string, text: string): GraphiumDocument =>
  ({ title, pages: [{ blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text }] }] }] }) as unknown as GraphiumDocument;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <div style={{ padding: 24, maxWidth: 560, background: "var(--paper)" }}>{children}</div>
    </LocaleProvider>
  );
}

/** 未ロード（サインイン前の状態）。ボタンは無効 */
export const NotLoaded: Story = {
  render: () => {
    lexicalSearch.__resetForTest();
    return (
      <Frame>
        <LexicalIndexCard />
      </Frame>
    );
  },
};

/** 索引済み: ソース数・断片数が出る */
export const Indexed: Story = {
  render: () => {
    function Seeded() {
      useEffect(() => {
        lexicalSearch.__resetForTest();
        void lexicalSearch.ensureLoaded("storybook:").then(() => {
          lexicalSearch.upsertNote("n1", "試薬 X の保管", doc("試薬 X の保管", "湿度 60% 以上で劣化する"), "1");
          lexicalSearch.upsertNote("n2", "焼結条件", doc("焼結条件", "SPS 100 MPa 1273 K 5 min"), "1");
          lexicalSearch.upsertAsset("a1", "manual.pdf", "PPMS thermal transport option", "1");
        });
      }, []);
      return <LexicalIndexCard />;
    }
    return (
      <Frame>
        <Seeded />
      </Frame>
    );
  },
};
