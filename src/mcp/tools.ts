// MCP ツールの定義。
//
// 設計方針:
//   - **返り値には必ず noteId と blockId を含める**。Claude が引用でき、ユーザーが
//     Graphium 側で該当ブロックに飛べるため。出典の辿れない要約は Graphium の趣旨に反する。
//   - read 系は vault を書き換えない。write は新規ノート作成のみ（既存ノートは触らない）。
//   - 会話の内容から手順・来歴を推論して書き戻すツールは作らない。推論された来歴は
//     検証できず、記録としての意味を失うため。

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createNote } from "./create-note";
import { ENTITY_LABELS, findNotesUsing, listEntities } from "./entities";
import { traceLineage } from "./lineage";
import { collectSteps, noteToMarkdown } from "./note-text";
import { addCreatedNoteToIndex, getEntry, searchNotes } from "./search";
import { readNote, resolveGraphiumRoot, vaultExists } from "./vault";

/** ツールの返り値（テキスト 1 本）を組む */
function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

/** vault が無いときの共通エラー。設定の直し方まで書く */
function vaultMissing() {
  return text(
    [
      `Graphium の vault が見つかりません: ${resolveGraphiumRoot()}`,
      "",
      "GRAPHIUM_ROOT 環境変数で vault のルート（notes/ を含むディレクトリ）を指定してください。",
      "Graphium アプリを一度も起動していない場合は、先に起動してノートを 1 つ作ってください。",
    ].join("\n"),
  );
}

export type ToolContext = {
  /**
   * MCP クライアント名（claude-desktop など）を返す。
   * initialize はサーバー connect の直後にはまだ完了していないため、値ではなく
   * 関数で受け取り、ツールが呼ばれた時点（= 必ず initialize 済み）で解決する。
   */
  getClientName?: () => string | undefined;
};

export function registerTools(server: McpServer, ctx: ToolContext = {}): void {
  // ── 1. 検索 ────────────────────────────────────────────────
  server.registerTool(
    "search_notes",
    {
      title: "ノートを検索",
      description:
        "Graphium の vault を全文検索する。日本語も分かち書きなしで検索できる。" +
        "タイトル・本文・手順名・PROV ラベルを対象にし、手順名とラベルは本文より重く扱う。" +
        "まず何があるか知りたいときの入口。",
      inputSchema: {
        query: z.string().describe("検索語。自然文でも単語でもよい"),
        limit: z.number().int().min(1).max(50).optional().describe("最大件数（既定 10）"),
        kind: z
          .enum(["note", "wiki"])
          .optional()
          .describe("note = 人が書いたノート、wiki = AI が生成したドキュメント。未指定なら両方"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit, kind }) => {
      if (!vaultExists()) return vaultMissing();
      const hits = searchNotes(query, { limit, kind });
      if (hits.length === 0) return text(`「${query}」に一致するノートはありませんでした。`);

      const lines = hits.map(
        (h, i) =>
          `${i + 1}. ${h.title}\n   noteId: ${h.noteId}  (${h.kind}, score ${h.score})\n   ${h.snippet}`,
      );
      return text(`${hits.length} 件見つかりました。\n\n${lines.join("\n\n")}`);
    },
  );

  // ── 2. ノート本文 ───────────────────────────────────────────
  server.registerTool(
    "get_note",
    {
      title: "ノートを読む",
      description:
        "ノート ID を指定して本文を Markdown で取得する。手順・PROV ラベル・他ノートへのリンクも併せて返す。" +
        "search_notes で当たりを付けてから読むのが基本。",
      inputSchema: {
        noteId: z.string().describe("ノート ID（search_notes の結果に含まれる）"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ noteId }) => {
      if (!vaultExists()) return vaultMissing();
      const doc = readNote(noteId);
      if (!doc) return text(`ノートが見つかりません: ${noteId}`);

      const entry = getEntry(noteId);
      const steps = collectSteps(doc);
      const parts: string[] = [`# ${doc.title ?? "(untitled)"}`, `noteId: ${noteId}`];

      if (entry?.modifiedAt) parts.push(`更新: ${entry.modifiedAt}`);
      if (doc.generatedBy) {
        const g = doc.generatedBy as { agent?: string; model?: string };
        parts.push(`書いたもの: ${g.agent ?? "human"}${g.model ? ` / ${g.model}` : ""}`);
      }
      if (steps.length > 0) {
        parts.push(
          `\n## 手順（${steps.length} 件）\n` +
            steps.map((s) => `${s.order}. ${s.title}  [blockId: ${s.blockId}]`).join("\n"),
        );
      }
      if (entry?.labels?.length) {
        parts.push(
          `\n## PROV ラベル\n` +
            entry.labels.map((l) => `- ${l.label}: ${l.preview}  [blockId: ${l.blockId}]`).join("\n"),
        );
      }
      if (entry?.outgoingLinks?.length) {
        const provLinks = entry.outgoingLinks.filter((l) => l.layer === "prov");
        if (provLinks.length > 0) {
          parts.push(
            `\n## 参照している上流ノート\n` +
              provLinks.map((l) => `- ${l.targetNoteId}`).join("\n") +
              `\n（詳しい関係は trace_lineage で辿れます）`,
          );
        }
      }

      parts.push(`\n## 本文\n\n${noteToMarkdown(doc)}`);
      return text(parts.join("\n"));
    },
  );

  // ── 3. 手順 ────────────────────────────────────────────────
  server.registerTool(
    "get_note_steps",
    {
      title: "手順を取り出す",
      description:
        "ノートの手順（step ブロック）を実行順に取り出す。各手順で使った材料・道具・条件（インラインラベル）も一緒に返す。" +
        "実験の再現手順を知りたいとき、条件を比較したいときに使う。",
      inputSchema: {
        noteId: z.string().describe("ノート ID"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ noteId }) => {
      if (!vaultExists()) return vaultMissing();
      const doc = readNote(noteId);
      if (!doc) return text(`ノートが見つかりません: ${noteId}`);

      const steps = collectSteps(doc);
      if (steps.length === 0) {
        return text(
          `このノートには手順ブロックがありません: ${doc.title ?? noteId}\n` +
            `（本文は get_note で読めます）`,
        );
      }

      const entry = getEntry(noteId);
      const inline = entry?.inlineLabels ?? [];

      const blocks = steps.map((s) => {
        const own = new Set([s.blockId, ...s.childBlockIds]);
        const labels = inline.filter((il) => own.has(il.blockId));
        const byLabel = ENTITY_LABELS.map((label) => {
          const items = labels.filter((l) => l.label === label).map((l) => l.text);
          return items.length ? `   ${label}: ${Array.from(new Set(items)).join(", ")}` : null;
        }).filter(Boolean);

        return [
          `${s.order}. ${s.title}  [blockId: ${s.blockId}]`,
          ...byLabel,
          s.body ? `   ${s.body.replace(/\n/g, "\n   ")}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      });

      return text(`# ${doc.title ?? noteId} の手順（${steps.length} 件）\n\n${blocks.join("\n\n")}`);
    },
  );

  // ── 4. 材料・道具の横断 ──────────────────────────────────────
  server.registerTool(
    "find_notes_using",
    {
      title: "この材料・道具を使ったノートを探す",
      description:
        "特定の材料・道具・条件・出力を使っているノートを横断で探す。" +
        "「グラファイトダイを使った実験は他にあるか」「Ar 雰囲気の手順を全部見たい」のような問いに答える。" +
        "text は正規化して部分一致で照合する。",
      inputSchema: {
        text: z.string().optional().describe("材料名・道具名など（例: グラファイトダイ）"),
        entityId: z.string().optional().describe("PROV Entity の同一性キー。text より厳密"),
        label: z
          .enum(["material", "tool", "attribute", "output"])
          .optional()
          .describe("ラベル種別で絞る"),
        partial: z.boolean().optional().describe("部分一致を許すか（既定 true）"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ text: needle, entityId, label, partial }) => {
      if (!vaultExists()) return vaultMissing();
      if (!needle && !entityId) return text("text か entityId のどちらかを指定してください。");

      const groups = findNotesUsing({ text: needle, entityId, label, partial });
      if (groups.length === 0) {
        return text(
          `該当するラベルは見つかりませんでした: ${needle ?? entityId}\n` +
            `（list_entities で vault にあるラベルの一覧を確認できます）`,
        );
      }

      const lines = groups.map((g) => {
        const notes = g.notes
          .map((n) => `   - ${n.title}  [noteId: ${n.noteId}, blockId: ${n.blockIds[0]}]`)
          .join("\n");
        return `■ ${g.label}: ${g.text}  — ${g.noteCount} ノート\n${notes}`;
      });
      return text(lines.join("\n\n"));
    },
  );

  // ── 5. ラベル一覧 ───────────────────────────────────────────
  server.registerTool(
    "list_entities",
    {
      title: "vault のラベル一覧",
      description:
        "vault 全体でどんな材料・道具・条件・出力にラベルが付いているかを、横断件数の多い順に一覧する。" +
        "何が記録されているか分からないときの入口。find_notes_using の前段に使うとよい。",
      inputSchema: {
        label: z
          .enum(["material", "tool", "attribute", "output"])
          .optional()
          .describe("ラベル種別で絞る"),
        minNotes: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("何ノート以上に出てくるものに絞るか（既定 1）。2 にすると横断するものだけ"),
        limit: z.number().int().min(1).max(200).optional().describe("最大件数（既定 100）"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ label, minNotes, limit }) => {
      if (!vaultExists()) return vaultMissing();
      const groups = listEntities({ label, minNotes, limit });
      if (groups.length === 0) {
        return text(
          "ラベルの付いたノートがまだありません。\n" +
            "Graphium でノート本文の材料・道具・条件・出力にラベルを付けると、ここから横断できるようになります。",
        );
      }
      const lines = groups.map(
        (g) => `${g.label.padEnd(9)} ${g.text}  — ${g.noteCount} ノート / ${g.occurrenceCount} 箇所`,
      );
      return text(`${groups.length} 件のラベル（横断件数の多い順）\n\n${lines.join("\n")}`);
    },
  );

  // ── 6. 来歴 ────────────────────────────────────────────────
  server.registerTool(
    "trace_lineage",
    {
      title: "来歴を辿る",
      description:
        "ノートの来歴（PROV 層のリンク）を辿る。upstream = このノートが元にした側、" +
        "downstream = このノートを元にした側。「この結論はどのデータから来たのか」を確かめるときに使う。",
      inputSchema: {
        noteId: z.string().describe("起点のノート ID"),
        direction: z
          .enum(["upstream", "downstream", "both"])
          .optional()
          .describe("辿る向き（既定 both）"),
        depth: z.number().int().min(1).max(5).optional().describe("何段辿るか（既定 2）"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ noteId, direction, depth }) => {
      if (!vaultExists()) return vaultMissing();
      const doc = readNote(noteId);
      if (!doc) return text(`ノートが見つかりません: ${noteId}`);

      const result = traceLineage(noteId, { direction, depth });
      const fmt = (nodes: typeof result.upstream) =>
        nodes.length === 0
          ? "  （なし）"
          : nodes
              .map(
                (n) =>
                  `  ${"  ".repeat(n.depth - 1)}└ [${n.via?.type ?? "?"}] ${n.title || n.noteId}` +
                  `  [noteId: ${n.noteId}]` +
                  (n.via?.stepTitle ? `  ← ${n.via.stepTitle}` : ""),
              )
              .join("\n");

      return text(
        [
          `# ${doc.title ?? noteId} の来歴`,
          "",
          "## 上流（このノートが元にしたもの）",
          fmt(result.upstream),
          "",
          "## 下流（このノートを元にしたもの）",
          fmt(result.downstream),
        ].join("\n"),
      );
    },
  );

  // ── 7. ノート作成 ───────────────────────────────────────────
  server.registerTool(
    "create_note",
    {
      title: "ノートを作成",
      description:
        "Graphium に新しいノートを作る。既存ノートは変更しない。" +
        "本文は Markdown（見出し・箇条書き・コード・表・強調に対応）。" +
        "誰がどの経路で書いたかは来歴として記録される。作成後、Graphium を再読み込みすると一覧に出る。",
      inputSchema: {
        title: z.string().describe("ノートのタイトル。命題形か問い形で書く（「〜について」は避ける）"),
        body: z.string().describe("Markdown 本文"),
        sessionId: z.string().optional().describe("呼び出し側のセッション識別子"),
        model: z.string().optional().describe("書いた LLM のモデル ID（例: claude-opus-5）"),
      },
    },
    async ({ title, body, sessionId, model }) => {
      try {
        const result = createNote({ title, body, sessionId, model, client: ctx.getClientName?.() });
        // 「保存して」の直後に「探して」が来ても引けるよう、索引にも即座に足す
        addCreatedNoteToIndex(result.noteId, title, body);
        return text(
          [
            `ノートを作成しました。`,
            `  タイトル: ${result.title}`,
            `  noteId: ${result.noteId}`,
            `  ファイル: ${result.filePath}`,
            "",
            `Graphium を再読み込みすると一覧に表示されます。`,
          ].join("\n"),
        );
      } catch (err) {
        return text(`ノートの作成に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}
