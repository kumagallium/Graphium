// テンプレートの一覧画面のストーリー（パン作りの世界観の英語データ）
// 公式・自分・共有が 1 つの表に並ぶ様子と、元のノート（開ける・見つからない・記録なし・他人の共有）、
// 使ったノートの件数を見る。保存先・共有ライブラリはストーリー内で差し替える。
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { TemplateListView, type TemplateListNote } from "./TemplateListView";
import {
  __setUserTemplateProviderForTest,
  saveUserTemplate,
  type UserTemplateProvider,
} from "./user-template-store";
import { __setSharedLibraryLoaderForTest, groupSharedEntriesByType } from "../sharing/shared-library-store";
import type { SharedEntry } from "../../lib/storage/shared";
import type { GraphiumPage } from "../../lib/document-types";
import "../../app.css";

const ME = { name: "Ada", email: "ada@example.com" };
const OTHER = { name: "Bob", email: "bob@example.com" };

const shared = (id: string, author: typeof ME, extra: Record<string, unknown>): SharedEntry =>
  ({
    id,
    type: "template",
    author,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-20T00:00:00Z",
    hash: `sha256:${id}`,
    prov: { derived_from: [] },
    version: 1,
    extra,
  }) as SharedEntry;

const NOTES: TemplateListNote[] = [
  { noteId: "n1", title: "Sourdough starter, day 1" },
  { noteId: "n2", title: "Country loaf, 2026-10-30", templateFrom: { kind: "official", id: "experiment" } },
  { noteId: "n3", title: "Country loaf, 2026-11-02", templateFrom: { kind: "official", id: "experiment" } },
];

function memoryProvider(): UserTemplateProvider {
  const store = new Map<string, unknown>();
  return {
    readAppData: async (k) => (store.has(k) ? store.get(k)! : null),
    writeAppData: async (k, v) => {
      store.set(k, structuredClone(v));
    },
    listAppDataKeys: async (p) => [...store.keys()].filter((k) => k.startsWith(p)),
    deleteAppData: async (k) => {
      store.delete(k);
    },
  };
}

const page = (title: string): GraphiumPage =>
  ({ id: "p", title, blocks: [{ id: "b1", type: "paragraph" }], labels: {} }) as unknown as GraphiumPage;

function Harness({ empty }: { empty?: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const provider = memoryProvider();
    __setUserTemplateProviderForTest(provider);
    const entries = empty
      ? []
      : [
          shared("s1", ME, { title: "Shaping and proofing", description: "Bench notes for shaping", sourceNote: { id: "n1", title: "Sourdough starter, day 1" } }),
          shared("s2", OTHER, { title: "Baguette scoring", sourceNote: { id: "x", title: "Bob's scoring tests" } }),
        ];
    __setSharedLibraryLoaderForTest(
      async () => ({ entries: groupSharedEntriesByType(entries), errors: {} }),
      { root: "/Volumes/bakery-share" },
    );
    (async () => {
      if (!empty) {
        await saveUserTemplate({ title: "Sourdough feeding log", description: "Ratio, temperature and rise per feeding", page: page("Feeding"), sourceNote: { id: "n1", title: "Sourdough starter, day 1" }, provider });
        await saveUserTemplate({ title: "Oven spring check", page: page("Oven"), sourceNote: { id: "gone", title: "Deleted bake" }, provider });
        await saveUserTemplate({ title: "Dough hydration table", page: page("Hydration"), provider });
      }
      setReady(true);
    })();
    return () => {
      __setUserTemplateProviderForTest(null);
      __setSharedLibraryLoaderForTest(null, { root: null });
    };
  }, [empty]);
  if (!ready) return null;
  return (
    <div style={{ height: "100vh" }}>
      <TemplateListView
        onBack={() => {}}
        notes={NOTES}
        onOpenNote={() => {}}
        onCreateFromOfficial={() => {}}
        onCreateFromUser={() => {}}
        onCreateFromShared={() => {}}
        onUnshare={() => {}}
        onUploadMedia={async () => "local:media"}
        currentEmail={ME.email}
      />
    </div>
  );
}

const meta: Meta<typeof Harness> = {
  title: "Template/TemplateListView",
  component: Harness,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof Harness>;

/** 公式・自分・共有がそろった状態 */
export const Default: Story = {};

/** 自分・共有が 1 件も無い（案内を出す） */
export const Empty: Story = { args: { empty: true } };
