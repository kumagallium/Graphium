// 読む側の追加ツール（export_prov / get_source_text / search_media / check_knowledge / list_source_check）。
// 仕様: docs/internal/mcp-upkeep-stage3-spec-2026-10.md §4
//
// 既存のツール（./tools.ts）とは分け、index.ts から registerReadTools を呼ぶ。
// どれも vault を書き換えない（readOnlyHint）。

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { buildProvJsonLdText } from "./export-prov";
import { checkKnowledge } from "./knowledge-check";
import { MEDIA_TYPES, searchMedia } from "./media-search";
import { getSourceText } from "./source-text";
import { listSourceCheck } from "./source-check-list";
import type { ToolContext } from "./tools";
import { readNote, resolveGraphiumRoot, vaultExists } from "./vault";

/** ツールの返り値（テキスト 1 本）を組む */
function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

/** vault が無いときの共通エラー。設定の直し方まで書く（tools.ts と同じ文面） */
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

export function registerReadTools(server: McpServer, _ctx: ToolContext = {}): void {
  // ── PROV-DM の書き出し ─────────────────────────────────────
  server.registerTool(
    "export_prov",
    {
      title: "PROV-DM を書き出す",
      description:
        "ノート 1 件の来歴（PROV-DM）を W3C PROV JSON-LD で返す。手順（Activity）・材料や出力（Entity）・" +
        "他ノートへのつながりを、他の来歴ツールに渡せる標準形式で欲しいときに使う。" +
        "Graphium の「PROV を書き出す」と同じ内容。図で見たいときは get_note_steps の format: \"mermaid\"。",
      inputSchema: {
        noteId: z.string().describe("ノート ID"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ noteId }) => {
      if (!vaultExists()) return vaultMissing();
      const doc = readNote(noteId);
      if (!doc) return text(`ノートが見つかりません: ${noteId}`);
      try {
        const out = buildProvJsonLdText(doc, noteId);
        return text(out ?? `このノートにはページがありません: ${doc.title ?? noteId}`);
      } catch (err) {
        return text(`PROV の書き出しに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // ── 資料の文字起こし ───────────────────────────────────────
  server.registerTool(
    "get_source_text",
    {
      title: "資料の本文を読む",
      description:
        "資料（PDF・Word・Web ページ・ノート）の本文を文字起こしして、窓（既定 4,000 字）に切って返す。" +
        "トピックの出典（pdf:… / document:… / url:…）の中身を確かめたいとき、PDF の特定ページを読みたいときに使う。" +
        "PDF は窓ごとに「ページ n〜m」を示し、page を指定するとそのページを含む窓を返す。" +
        "続きは window を 1 つ進める。Web ページは Graphium に登録済みのものだけを、ネットワークから取り直して読む。" +
        "Word は .docx だけに対応。資料の id は get_topic・search_media に出てくる。",
      inputSchema: {
        sourceId: z
          .string()
          .describe("資料の id: pdf:<fileId> / document:<fileId> / url:<URL>（登録済みのもの）/ ノート ID"),
        window: z.number().int().min(0).optional().describe("窓の番号（0 始まり。既定 0）"),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("PDF のページ（1 始まり）。指定すると window より優先し、そのページの先頭を含む窓を返す"),
        windowChars: z
          .number()
          .int()
          .optional()
          .describe("窓の大きさ（文字数。既定 4000、1000 未満は 1000 になる）"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ sourceId, window, page, windowChars }) => {
      if (!vaultExists()) return vaultMissing();
      try {
        return text(await getSourceText({ sourceId, window, page, windowChars }));
      } catch (err) {
        return text(`EXTRACT_FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // ── 素材の検索 ─────────────────────────────────────────────
  server.registerTool(
    "search_media",
    {
      title: "素材を探す",
      description:
        "Graphium の素材（画像・PDF・Word・Web ページなど）を、名前・画像から読み取った文字（OCR）・" +
        "Web ページの説明やドメインで探す。「あの図はどのファイルだったか」「このテーマの PDF はあるか」のようなときに使う。" +
        "結果の id はそのまま get_source_text に渡せる。アーカイブした素材は出ない。",
      inputSchema: {
        query: z.string().describe("検索語。自然文でも単語でもよい"),
        type: z.enum(MEDIA_TYPES).optional().describe("素材の種類で絞る"),
        limit: z.number().int().min(1).max(100).optional().describe("最大件数（既定 20）"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, type, limit }) => {
      if (!vaultExists()) return vaultMissing();
      const hits = searchMedia(query, { type, limit });
      if (hits.length === 0) return text(`「${query}」に一致する素材はありませんでした。`);
      const lines = hits.map((h, i) => {
        const used =
          h.usedIn.length > 0
            ? `   使っているノート: ${h.usedIn.map((u) => `${u.title}  [noteId: ${u.noteId}]`).join(" / ")}`
            : "   使っているノート: なし（または Graphium の次回保存後に反映）";
        return `${i + 1}. ${h.name}\n   id: ${h.id}  (${h.type}, 取り込み ${h.uploadedAt.slice(0, 10) || "不明"})\n${used}`;
      });
      return text(`${hits.length} 件見つかりました。\n\n${lines.join("\n\n")}`);
    },
  );

  // ── 点検（機械判定） ───────────────────────────────────────
  server.registerTool(
    "check_knowledge",
    {
      title: "ナレッジを点検",
      description:
        "ナレッジ層（トピック・知見・回答など）を機械で点検する。孤立したページ・空のページ・同名の重複・" +
        "資料の欠落・矛盾の印・自動アーカイブ候補を、id とタイトルつきで返す。" +
        "「ナレッジを整理したい」「重複しているトピックはあるか」のときの入口で、見つけた重複は merge_topics、" +
        "不要なページは archive_page で手入れできる。AI を使う判定（古さ・穴・意味的な重複）は含まない。",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      if (!vaultExists()) return vaultMissing();
      try {
        return text(checkKnowledge());
      } catch (err) {
        return text(`点検に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  // ── 出典照合の結果 ─────────────────────────────────────────
  server.registerTool(
    "list_source_check",
    {
      title: "出典照合の要確認を見る",
      description:
        "出典照合（ページの文が引いた資料に本当に書かれているかの判定）で「要確認」になっているページを返す。" +
        "出典と異なる（contradicted）ものを先に、出典に見当たらない（not-in-source）ものを次に並べ、" +
        "該当する文と出典の抜粋を添える。書き直しが必要なページを探すときに使う（直すのは revise_topic）。" +
        "照合そのものは Graphium で行う。",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      if (!vaultExists()) return vaultMissing();
      try {
        return text(listSourceCheck());
      } catch (err) {
        return text(`一覧の取得に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}
