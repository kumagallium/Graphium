// 共有エントリの全画面「AI に質問」パネル。
//
// なぜノートのチャット経路（handleAiChatSubmit / chat-run-manager）を使わないか:
//   あちらはノート本文へ書き戻す前提の重い経路で、応答の宛先が「ノート id と
//   ScopeChat id」で決まる。共有エントリには書き戻す本文が無く、書き戻してもいけない。
//   ここは素材ビュー（MaterialFullView の handleAssetChatSubmit）と同じ軽量経路
//   —— runAgent を直接呼び、応答は store に積むだけ —— に、履歴・session_id・
//   横断検索・Stop を足してノートのチャット並みの会話にしている。
//
// 既知の制限: 画面を離れると実行中の応答は失われる（素材ビューと同じ）。
//   バックグラウンド継続は chat-run-manager の担当で、そこはノート id を宛先に
//   持つ設計になっている。共有エントリを宛先にするのはこの PR の範囲外。
//
// 守っていること:
//   - 共有フォルダには一切書かない。会話は手元の appData `shared-chats:<id>`
//   - 本文は毎ターン、その時点の user message に同梱する（履歴には積まない）
//   - PROV には記録しない。派生ノート・挿入・置換・ナレッジ候補は出さない
//     （onInsertToScope / onReplaceBlocks / onDeriveNote /
//      onGenerateKnowledgeCandidates を渡さない）
//
// 設計詳細: docs/internal/team-shared-storage-design.md §23

import { useCallback, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import type { ChatMessage, GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";
import { useT, getLocale } from "../../i18n";
import { localizeAiError } from "../../lib/ai-error";
import { isAbortError } from "../../lib/abort-error";
import {
  DEFAULT_GROUNDING_SCOPE,
  includesCrossSearch,
  type GroundingScope,
} from "../../lib/grounding-scope";
import { getActiveProvider } from "../../lib/storage/registry";
import { isAgentConfigured, getChatSynthesisModelName } from "../settings";
import { graphiumDocToMarkdown } from "../markdown-export/doc-to-markdown";
// barrel（../ai-assistant）は循環するので実ファイルを指す
import { AiAssistantPanel } from "../ai-assistant/panel";
import { useAiAssistant } from "../ai-assistant/store";
import { runAgent, type AgentRunRequest, type AgentRunResponse } from "../ai-assistant/api";
import { useAppDataChatPersistence } from "../ai-assistant/use-app-data-chat-persistence";
import type { AppDataChatProviderSource } from "../ai-assistant/use-app-data-chat-persistence";
import {
  buildSharedChatMessage,
  buildSharedRetrievalQuery,
  buildSharedSubject,
  sharedChatsKey,
  toAgentHistory,
  type SharedChatSubject,
} from "./shared-chat";

/**
 * 外から差し替えられる実行環境（Storybook / テスト用）。
 * 未指定なら実物（runAgent / wiki retriever / Markdown 変換 / 現在のプロバイダ）。
 */
export type SharedNoteChatDeps = {
  runAgent?: (req: AgentRunRequest, signal?: AbortSignal) => Promise<AgentRunResponse>;
  retrieveWikiContext?: (
    query: string,
    excludeIds?: Set<string>,
  ) => Promise<string | null>;
  toMarkdown?: (doc: GraphiumDocument) => Promise<string>;
  /** 会話の保存先（appData）。既定は現在のストレージプロバイダ */
  provider?: AppDataChatProviderSource;
  /** タイムスタンプの発生源（テストで固定するため） */
  now?: () => Date;
};

export type SharedNoteChatPanelProps = {
  entry: SharedEntry;
  /** 共有本文（useSharedEntryBodyText の結果）。読み込み中は null */
  body: string | null;
  /** 共有ストレージのハッシュ照合が通ったか。false なら注意行と断りを足す */
  verified: boolean;
  /** 会話を手元の Knowledge に取り込む（note-app の既存ハンドラ） */
  onIngestChat?: (messages: ChatMessage[]) => void;
  deps?: SharedNoteChatDeps;
};

export function SharedNoteChatPanel({
  entry,
  body,
  verified,
  onIngestChat,
  deps,
}: SharedNoteChatPanelProps) {
  const t = useT();
  const aiAssistant = useAiAssistant();

  // 会話は手元の appData にだけ残す（共有フォルダには書かない）
  useAppDataChatPersistence({
    provider: deps?.provider ?? getActiveProvider,
    key: sharedChatsKey(entry.id),
  });

  // 本文は非同期に届く。送信の瞬間の値を読むので ref で持つ
  // （依存に載せると送信ハンドラが本文の到着で作り直される）
  const bodyRef = useRef(body);
  bodyRef.current = body;

  // 実行中の応答を止めるための AbortController（Stop ボタン）
  const abortRef = useRef<AbortController | null>(null);

  // 主題（本文 → Markdown）は Markdown 変換を伴うので毎ターン作り直さない。
  // entry オブジェクトは共有フォルダを読み直すたびに作り直されるので、
  // 中身が変わったかどうかは id と hash で見る
  const subjectRef = useRef<{ key: string; subject: SharedChatSubject | null } | null>(null);
  const resolveSubject = useCallback(async (): Promise<SharedChatSubject | null> => {
    const currentBody = bodyRef.current;
    if (currentBody === null) return null;
    const cacheKey = `${entry.id}|${entry.hash}`;
    const cached = subjectRef.current;
    if (cached && cached.key === cacheKey) return cached.subject;
    const subject = await buildSharedSubject(entry, currentBody, {
      toMarkdown: deps?.toMarkdown ?? graphiumDocToMarkdown,
      uiT: t,
    });
    subjectRef.current = { key: cacheKey, subject };
    return subject;
  }, [entry, deps?.toMarkdown, t]);

  const handleSubmit = useCallback(
    async (
      question: string,
      _attachedNotes?: unknown,
      scope: GroundingScope = DEFAULT_GROUNDING_SCOPE,
      rewindIndex?: number,
    ) => {
      if (!isAgentConfigured()) {
        aiAssistant.setError(t("settings.aiNotConfigured"));
        return;
      }
      // 本文が届く前に押されたとき。押せるのに黙って何も起きない状態を作らない。
      // ここは同期で見る（await を挟むと loading が立つ前に二重送信できてしまう）
      if (bodyRef.current === null) {
        aiAssistant.setError(t("sharedNote.chat.bodyNotReady"));
        return;
      }

      // 引用チャット（段落クリックで始めた会話）の主題。store が持っている
      const quotedMarkdown = aiAssistant.quotedMarkdown.trim() || undefined;
      // 編集&再実行 / 回答の再生成では、その位置以降を捨てて送り直す
      const baseMessages =
        rewindIndex != null
          ? aiAssistant.messages.slice(0, rewindIndex)
          : aiAssistant.messages;
      const isFirstMessage = baseMessages.length === 0;
      const now = deps?.now ?? (() => new Date());
      const chatId = aiAssistant.activeChatId ?? crypto.randomUUID();
      const userChatMessage: ChatMessage = {
        role: "user",
        content: question,
        timestamp: now().toISOString(),
      };
      if (rewindIndex != null) {
        aiAssistant.rewriteFrom(rewindIndex, userChatMessage, chatId);
      } else {
        aiAssistant.addMessage(userChatMessage, chatId);
      }
      // setError は loading も落とすので、順序を逆にすると送信直後に
      // 「実行中」の表示が出ないまま Stop も押せなくなる
      aiAssistant.setError(null);
      aiAssistant.setLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        // 主題（本文 → Markdown）を組むのは loading を立てたあと。先に await すると
        // 変換を待つ間も Send が押せたままで、同じ履歴を読んだ runAgent が 2 本走る
        const subject = await resolveSubject();
        if (!subject) {
          aiAssistant.setError(t("sharedNote.chat.bodyNotReady"));
          return;
        }

        const message = buildSharedChatMessage({
          subject,
          question,
          isFirstMessage,
          quotedMarkdown,
          verified,
        });

        // 横断検索（内部参照・外部参照のとき）。このエントリ自身は除く
        // ——同じ文章を「背景」と「検索で見つけた断片」の二重で渡さない
        let wikiContext: string | undefined;
        if (includesCrossSearch(scope)) {
          try {
            const retrieve =
              deps?.retrieveWikiContext ??
              (await import("../wiki/retriever")).retrieveWikiContext;
            const found = await retrieve(
              buildSharedRetrievalQuery({ subject, question, quotedMarkdown }),
              new Set([entry.id]),
            );
            wikiContext = found ?? undefined;
          } catch {
            // Retriever 失敗は無視（embedding が無い場合など）
          }
        }

        const selectedModel = getChatSynthesisModelName();
        const history = toAgentHistory(
          baseMessages,
          quotedMarkdown ? { subject, quotedMarkdown } : undefined,
        );
        const response = await (deps?.runAgent ?? runAgent)(
          {
            message,
            messages: [...history, { role: "user", content: message }],
            ...(aiAssistant.sessionId ? { session_id: aiAssistant.sessionId } : {}),
            ...(wikiContext ? { wiki_context: wikiContext } : {}),
            grounding_scope: scope,
            language: getLocale(),
            options: { max_turns: 5, ...(selectedModel ? { model: selectedModel } : {}) },
          },
          controller.signal,
        );

        // 回答の後処理はノートのチャットと同じ（引用の正規化 → 出典 → MCP の断り）
        let assistantMessage = response.message;
        if (wikiContext) {
          const { normalizeWikiCitations, appendKnowledgeReferenced } = await import(
            "../ai-assistant/citation-normalize"
          );
          const normalized = normalizeWikiCitations(assistantMessage, wikiContext);
          assistantMessage = appendKnowledgeReferenced(
            normalized.message,
            normalized.sources,
            t("chat.sources.fromNotes"),
          );
        }
        const webHeading = t("chat.sources.fromWeb");
        // モデルが散文中に自前で書いた "Sources:" 見出しはローカライズ済みの節に差し替える
        assistantMessage = assistantMessage.replace(
          /^[ \t]*(?:#{1,6}[ \t]*)?\*{0,2}Sources:?\*{0,2}[ \t]*$/im,
          `**${webHeading}**`,
        );
        const webSources = response.web_sources ?? [];
        if (webSources.length > 0 && !assistantMessage.includes(webHeading)) {
          const list = webSources
            .map((s) => `  - [${(s.title ?? s.url).replace(/[[\]]/g, "")}](${s.url})`)
            .join("\n");
          assistantMessage = `${assistantMessage}\n\n---\n**${webHeading}**\n${list}`;
        }
        const mcpErrors = response.mcp_errors ?? [];
        if (mcpErrors.length > 0) {
          const names = mcpErrors.map((e) => e.name).filter(Boolean).join(", ");
          assistantMessage =
            `${assistantMessage}\n\n---\n⚠️ ${t("settings.mcp.errorBanner")}` +
            (names ? `\n\n  - ${names}` : "");
        }
        const cleanMessage = assistantMessage.replace(
          /\s*<!--\s*wiki_worthy:\s*(?:true|false)\s*-->\s*$/,
          "",
        );

        aiAssistant.addMessage(
          { role: "assistant", content: cleanMessage, timestamp: now().toISOString() },
          chatId,
        );
        aiAssistant.setSessionId(response.session_id);
      } catch (err) {
        // Stop は「やめた」であってエラーではない（文言を出さない）
        if (!isAbortError(err)) aiAssistant.setError(localizeAiError(err));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        aiAssistant.setLoading(false);
      }
    },
    [aiAssistant, deps, entry.id, resolveSubject, t, verified],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const handleFork = useCallback(
    (index: number) => aiAssistant.forkChatAt(index),
    [aiAssistant],
  );

  return (
    // overflow-auto にしない: AiAssistantPanel が自分の中で
    // 「一覧はスクロール・入力欄は下端に固定」を組む（素材ビューと同じ箱）
    <div className="flex-1 min-h-0 flex flex-col">
      {!verified && (
        <div
          className="px-3 py-2 border-b border-border flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground"
          data-testid="shared-note-chat-unverified"
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />
          <span>{t("sharedNote.chat.unverified")}</span>
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-col">
        <AiAssistantPanel
          onSubmit={(q, attached, scope, rewindIndex) => {
            void handleSubmit(q, attached, scope, rewindIndex);
          }}
          onStop={handleStop}
          onForkChat={handleFork}
          onIngestChat={onIngestChat}
          noteIndex={null}
        />
      </div>
    </div>
  );
}
