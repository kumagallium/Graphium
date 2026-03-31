import { ReactNode, StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SandboxEditor } from "./base/editor";
import { MultiPageLayout, useMultiPage } from "./base/multipage";
import { helloBlock } from "./blocks/example-hello";
import {
  LabelBadgeLayer,
  LabelDropdownPortal,
  LabelSideMenuButton,
  LabelStoreProvider,
  useLabelStore,
  LABEL_GUTTER_WIDTH,
} from "./features/context-label";
import { setOnPrevStepLinkSelected } from "./features/context-label/ui";
import {
  LinkStoreProvider,
  LinkBadgeLayer,
  useLinkStore,
} from "./features/block-link";
import {
  generateProvDocument,
  ProvGraphPanel,
  type ProvDocument,
} from "./features/prov-generator";
import { NoteApp } from "./note-app";
import type { CustomBlockEntry } from "./base/schema";
import { cn } from "./lib/utils";
import {
  AddBlockButton,
  DragHandleButton,
  SideMenu,
  useBlockNoteEditor,
  useExtensionState,
} from "@blocknote/react";
import { SideMenuExtension } from "@blocknote/core/extensions";
import "./app.css";

// ── モード判定 ──
// ?sandbox パラメータがある場合はサンドボックスモード
const isSandboxMode = new URLSearchParams(window.location.search).has("sandbox");

// ── サンドボックスモード（既存の実験環境） ──────────

type Experiment = {
  id: string;
  name: string;
  description: string;
  layer: "blocks" | "features" | "scenarios";
  blocks: CustomBlockEntry[];
  initialContent?: any[];
  renderEditor?: (key: string) => ReactNode;
};

const contextLabelInitialContent = [
  {
    id: "block-title",
    type: "heading",
    props: { level: 1 },
    content: [{ type: "text", text: "Cu粉末アニール実験", styles: {} }],
  },
  {
    id: "block-step1",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "1. 封入する", styles: {} }],
  },
  {
    id: "block-used1",
    type: "paragraph",
    content: [{ type: "text", text: "Cu粉末 1g、シリカ管", styles: {} }],
  },
  {
    id: "block-result1",
    type: "paragraph",
    content: [{ type: "text", text: "封入されたCu粉末", styles: {} }],
  },
  {
    id: "block-step2",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "2. アニールする", styles: {} }],
  },
  {
    id: "block-sample-table",
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        {
          cells: [
            [{ type: "text", text: "パターン名", styles: {} }],
            [{ type: "text", text: "温度", styles: {} }],
            [{ type: "text", text: "時間", styles: {} }],
          ],
        },
        {
          cells: [
            [{ type: "text", text: "パターンA", styles: {} }],
            [{ type: "text", text: "600℃", styles: {} }],
            [{ type: "text", text: "24h", styles: {} }],
          ],
        },
        {
          cells: [
            [{ type: "text", text: "パターンB", styles: {} }],
            [{ type: "text", text: "700℃", styles: {} }],
            [{ type: "text", text: "24h", styles: {} }],
          ],
        },
        {
          cells: [
            [{ type: "text", text: "パターンC", styles: {} }],
            [{ type: "text", text: "800℃", styles: {} }],
            [{ type: "text", text: "24h", styles: {} }],
          ],
        },
      ],
    },
  },
  {
    id: "block-step3",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "3. 評価する", styles: {} }],
  },
  {
    id: "block-result3",
    type: "paragraph",
    content: [{ type: "text", text: "XRD測定により相同定を行う。", styles: {} }],
  },
];

const initialLabels: [string, string][] = [
  ["block-step1", "[手順]"],
  ["block-used1", "[使用したもの]"],
  ["block-result1", "[結果]"],
  ["block-step2", "[手順]"],
  ["block-sample-table", "[パターン]"],
  ["block-step3", "[手順]"],
  ["block-result3", "[結果]"],
];

const initialLinks: { sourceBlockId: string; targetBlockId: string }[] = [
  { sourceBlockId: "block-step2", targetBlockId: "block-step1" },
  { sourceBlockId: "block-step3", targetBlockId: "block-step2" },
];

const experiments: Experiment[] = [
  {
    id: "base",
    name: "ベースエディタ",
    description: "BlockNote標準ブロックのみ（カスタムなし）",
    layer: "blocks",
    blocks: [],
  },
  {
    id: "example-hello",
    name: "Hello Block",
    description: "最小構成のカスタムブロック例",
    layer: "blocks",
    blocks: [helloBlock],
  },
  {
    id: "context-label",
    name: "コンテキストラベル + リンク",
    description: "PROVラベル・ブロック間リンク・テンプレート（Session 1-4）",
    layer: "features",
    blocks: [],
    renderEditor: (_key) => <ContextLabelExperiment />,
  },
];

let openLinkDropdownFn: ((params: {
  type: "prevStep" | "general";
  sourceBlockId: string;
  anchorRect: { top: number; left: number };
}) => void) | null = null;

function LinkSideMenu() {
  return (
    <SideMenu>
      <LabelSideMenuButton />
      <LinkSideMenuButton />
      <AddBlockButton />
      <DragHandleButton />
    </SideMenu>
  );
}

function LinkSideMenuButton() {
  const editor = useBlockNoteEditor<any, any, any>();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  if (!block) return null;

  const handleClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openLinkDropdownFn?.({
      type: "general",
      sourceBlockId: block.id,
      anchorRect: { top: rect.bottom + 4, left: rect.left },
    });
  };

  return (
    <button
      onClick={handleClick}
      title="このブロックから新ページを派生"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: 4,
        border: "1px dashed #b8d4bb",
        background: "none",
        cursor: "pointer",
        color: "#8db899",
        fontSize: 11,
        lineHeight: 1,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "#4B7A52";
        e.currentTarget.style.color = "#4B7A52";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#b8d4bb";
        e.currentTarget.style.color = "#8db899";
      }}
    >
      &#128279;
    </button>
  );
}

function ContextLabelExperiment() {
  return (
    <LabelStoreProvider>
      <LinkStoreProvider>
        <ContextLabelExperimentInner />
      </LinkStoreProvider>
    </LabelStoreProvider>
  );
}

function ContextLabelExperimentInner() {
  const { pages, activePageId, setActivePageId, addPage, removePage } = useMultiPage("Untitled");
  const labelStore = useLabelStore();
  const linkStore = useLinkStore();
  const editorRef = useRef<any>(null);
  const [provDoc, setProvDoc] = useState<ProvDocument | null>(null);
  const initializedRef = useRef(false);

  const handleEditorReady = useCallback((editor: any) => {
    editorRef.current = editor;
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    for (const [blockId, label] of initialLabels) {
      labelStore.setLabel(blockId, label);
    }
    for (const { sourceBlockId, targetBlockId } of initialLinks) {
      linkStore.addLink({ sourceBlockId, targetBlockId, type: "informed_by", createdBy: "system" });
    }
  }, [labelStore, linkStore]);

  const handleGenerateProv = () => {
    if (!editorRef.current) return;
    const blocks = editorRef.current.document;
    const doc = generateProvDocument({ blocks, labels: labelStore.labels, links: linkStore.links });
    setProvDoc(doc);
  };

  useEffect(() => {
    setOnPrevStepLinkSelected((sourceBlockId: string, targetBlockId: string) => {
      linkStore.addLink({ sourceBlockId, targetBlockId, type: "informed_by", createdBy: "human" });
    });
    return () => { setOnPrevStepLinkSelected(null); };
  }, [linkStore]);

  useEffect(() => {
    openLinkDropdownFn = (params) => {
      const sourceBlockId = params.sourceBlockId;
      const el = document.querySelector(`[data-id="${sourceBlockId}"][data-node-type="blockOuter"]`);
      const heading = el?.querySelector("h1, h2, h3");
      const title = heading?.textContent || "派生ページ";
      const newPageId = addPage(`↳ ${title}`, { pageId: activePageId, blockId: sourceBlockId });
      linkStore.addLink({
        sourceBlockId, targetBlockId: newPageId ?? "", type: "derived_from", createdBy: "system", targetPageId: newPageId,
      });
    };
    return () => { openLinkDropdownFn = null; };
  }, [activePageId, addPage, linkStore]);

  return (
    <>
      <LabelDropdownPortal />
      <LinkBadgeLayer />
      <div style={{ display: "flex", height: "100%", width: "100%", gap: 0, overflow: "hidden" }}>
        <div data-label-wrapper style={{ flex: 1, minWidth: 0, overflow: "auto", position: "relative", paddingLeft: LABEL_GUTTER_WIDTH }}>
          <LabelBadgeLayer />
          <MultiPageLayout pages={pages} activePageId={activePageId} onSelectPage={setActivePageId} onAddPage={(title) => addPage(title)} onRemovePage={removePage}>
            {(pageId) => (
              <div style={{ padding: "16px 0" }}>
                <SandboxEditor key={pageId} blocks={[]} initialContent={pageId === pages[0]?.id ? contextLabelInitialContent : undefined} sideMenu={LinkSideMenu} onEditorReady={handleEditorReady} />
              </div>
            )}
          </MultiPageLayout>
        </div>
        <div style={{ width: 480, flexShrink: 0, borderLeft: "1px solid #e5e7eb", background: "#fafbfc", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: "0.05em" }}>手順</span>
            <button onClick={handleGenerateProv} style={{ padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 4, border: "1px solid #4B7A52", background: "#edf5ee", color: "#4B7A52", cursor: "pointer" }}>生成</button>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}><ProvGraphPanel doc={provDoc} /></div>
        </div>
      </div>
    </>
  );
}

const layerLabels: Record<string, string> = {
  blocks: "Blocks",
  features: "Features",
  scenarios: "Scenarios",
};

function SandboxApp() {
  const [selected, setSelected] = useState<string>("context-label");
  const current = experiments.find((e) => e.id === selected)!;

  return (
    <div className="flex h-screen font-sans antialiased bg-background text-foreground">
      <aside className="w-64 shrink-0 border-r border-sidebar-border bg-sidebar-background overflow-y-auto">
        <div className="p-4">
          <h2 className="text-sm font-semibold text-sidebar-foreground/60 mb-4 tracking-wide">
            provnote <span className="text-[10px] font-normal text-muted-foreground">(sandbox)</span>
          </h2>
          {(["blocks", "features", "scenarios"] as const).map((layer) => {
            const items = experiments.filter((e) => e.layer === layer);
            if (items.length === 0) return null;
            return (
              <div key={layer} className="mb-5">
                <div className="text-[11px] font-semibold uppercase text-muted-foreground/70 mb-1.5 tracking-wider px-2">{layerLabels[layer]}</div>
                {items.map((exp) => (
                  <button key={exp.id} onClick={() => setSelected(exp.id)} className={cn("w-full text-left rounded-md px-2 py-1.5 mb-0.5 text-sm transition-colors", selected === exp.id ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50")}>
                    {exp.name}
                    <span className="block text-[11px] text-muted-foreground mt-0.5">{exp.description}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </aside>
      <main className="flex-1 overflow-hidden flex flex-col">
        <div className="px-6 py-3 border-b border-border text-sm text-muted-foreground shrink-0">
          <span>{current.layer}</span>
          <span className="mx-1.5">/</span>
          <span className="font-medium text-foreground">{current.name}</span>
        </div>
        {current.renderEditor ? (
          <div className="flex-1 overflow-hidden">{current.renderEditor(current.id)}</div>
        ) : (
          <div className="max-w-3xl mx-auto w-full px-4 py-6 overflow-auto">
            <SandboxEditor key={current.id} blocks={current.blocks} initialContent={current.initialContent} />
          </div>
        )}
      </main>
    </div>
  );
}

// ── エントリーポイント ──
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isSandboxMode ? <SandboxApp /> : <NoteApp />}
  </StrictMode>
);
