// テンプレート適用のストーリー
//
// 計画テンプレートは「対象と詳細ノートを紐付けるインデックステーブル付き比較プラン」
// （template.plan.desc / マニュアル）なので、挿入された「対象と条件」の表は
// インデックステーブル（行からノートを作れる表）になっていなければならない。
//   - 行頭にノート作成ボタン（「S-01 のノートを作成」）が出る
//   - ⠿ メニューに「インデックステーブルを解除」が出る（= 登録済み）
// を目視確認する。適用手順は note-app の handleTemplateSelect と同じ
// （挿入前に id を振る → columnTypes の path を id に解決 → insertBlocks →
//   先頭列名をキーに tableMeta へ note-link を付ける）。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Component, useCallback, useRef, type ReactNode } from "react";
import { SandboxEditor } from "../../base/editor";
import "../../app.css";
import { t } from "../../i18n";
import {
  LabelStoreProvider,
  ProvLabelsEnabledProvider,
} from "../context-label/store";
import { LinkStoreProvider } from "../block-link/store";
import { TableMetaStoreProvider, useTableMetaStore } from "../table-meta/store";
import { readFirstColumnName } from "../table-meta/table-cells";
import { MediaInlineLabelProvider } from "../inline-label/media-store";
import { MediaOcrProvider } from "../media-ocr/store";
import { BlockAlignmentProvider } from "../block-alignment/store";
import { AiAssistantProvider } from "../ai-assistant/store";
import { IndexTableIconLayer } from "../index-table/icon-layer";
import { NoteSideMenu } from "../../components/side-menu";
import { getAllTemplates } from "./templates";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: "#c26356", fontSize: 13 }}>
          <strong>描画エラー:</strong> {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function EditorProviders({ children }: { children: ReactNode }) {
  return (
    <ProvLabelsEnabledProvider enabled={false}>
      <LabelStoreProvider>
        <LinkStoreProvider>
          <TableMetaStoreProvider>
            <MediaInlineLabelProvider>
              <MediaOcrProvider>
                <BlockAlignmentProvider>
                  <AiAssistantProvider aiAvailable={false}>{children}</AiAssistantProvider>
                </BlockAlignmentProvider>
              </MediaOcrProvider>
            </MediaInlineLabelProvider>
          </TableMetaStoreProvider>
        </LinkStoreProvider>
      </LabelStoreProvider>
    </ProvLabelsEnabledProvider>
  );
}

/** note-app の handleTemplateSelect と同じく、挿入前に全ブロックへ id を振る */
function assignIds(list: any[]) {
  for (const b of list ?? []) {
    if (b && typeof b === "object") {
      if (!b.id) b.id = crypto.randomUUID();
      if (Array.isArray(b.children)) assignIds(b.children);
    }
  }
}

/** path（ルートからのインデックス配列）でブロック id を引く */
function idAtPath(blocks: any[], path: number[]): string | null {
  let nodes: any[] = blocks;
  let node: any = null;
  for (const idx of path) {
    node = nodes?.[idx];
    if (!node) return null;
    nodes = node.children ?? [];
  }
  return node?.id ?? null;
}

/**
 * テンプレートをエディタに適用するデモ本体。
 * applyColumnTypes=false は修正前の見え方（表が素の table のまま）を比較用に再現する。
 */
function TemplateDemoInner({
  templateId,
  applyColumnTypes,
}: {
  templateId: string;
  applyColumnTypes: boolean;
}) {
  const editorRef = useRef<any>(null);
  const store = useTableMetaStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const appliedRef = useRef(false);

  const handleEditorReady = useCallback(
    (editor: any) => {
      editorRef.current = editor;
      if (appliedRef.current) return;
      appliedRef.current = true;

      const tmpl = getAllTemplates().find((x) => x.id === templateId);
      if (!tmpl) return;
      const { blocks, columnTypes } = tmpl.build(t);
      assignIds(blocks);
      // 変換前に id へ解決（note-app と同じ）
      const marks = (columnTypes ?? []).map((c) => ({
        blockId: idAtPath(blocks, c.path),
        type: c.type,
      }));

      const trigger = (editor.document as any[])[0];
      editor.insertBlocks(blocks, trigger, "after");
      editor.removeBlocks([trigger]);

      if (!applyColumnTypes) return;
      // 挿入した表の先頭列にふるまいを付ける（スラッシュ挿入と同じ addColumnType）
      setTimeout(() => {
        for (const { blockId, type } of marks) {
          if (!blockId) continue;
          const block = editor.getBlock(blockId);
          storeRef.current.addColumnType(blockId, readFirstColumnName(block), type);
        }
      }, 0);
    },
    [templateId, applyColumnTypes],
  );

  return (
    // 行頭アイコンは表の左 76px に fixed で出るので、左に余白を取る
    <div
      data-label-wrapper
      style={{
        position: "relative",
        maxWidth: 760,
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: "20px 16px 16px 100px",
      }}
    >
      <SandboxEditor
        initialContent={[{ type: "paragraph", content: [] }]}
        sideMenu={NoteSideMenu}
        onEditorReady={handleEditorReady}
      />
      <IndexTableIconLayer editorRef={editorRef} />
    </div>
  );
}

const meta: Meta = {
  title: "Features/Template",
  parameters: { layout: "padded" },
};
export default meta;

export const PlanTemplate: StoryObj = {
  name: "計画テンプレート（表がインデックステーブルになる）",
  render: () => (
    <ErrorBoundary>
      <EditorProviders>
        <TemplateDemoInner templateId="plan" applyColumnTypes />
      </EditorProviders>
    </ErrorBoundary>
  ),
};

export const PlanTemplateWithoutColumnTypes: StoryObj = {
  name: "（比較）columnTypes を適用しない場合 — 素の table のまま",
  render: () => (
    <ErrorBoundary>
      <EditorProviders>
        <TemplateDemoInner templateId="plan" applyColumnTypes={false} />
      </EditorProviders>
    </ErrorBoundary>
  ),
};
