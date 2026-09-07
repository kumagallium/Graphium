// 共有エントリの「AI に質問」に渡すものの組み立て。
//
// 対象の不変条件:
// - type ごとに本文の取り方が変わる（note/knowledge は Markdown、template は擬似 doc 経由、
//   reference はメタの箇条書き、report は素のテキスト、data-manifest / comment は対象外）
// - 共有ノート JSON の chats・来歴は AI に渡らない（pages[].blocks だけ）
// - 予算超過は行の切れ目で切り、切ったことを本文に明示する
// - 前置きは初回 / 継続 / 引用あり / ハッシュ未照合で変わる
// - 横断検索のクエリに本文全文を混ぜない
// - 履歴はサーバーに送る形に写し、引用チャットでは先頭に引用を再注入する

import { describe, expect, it, vi } from "vitest";
import type { GraphiumDocument, ChatMessage } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";
import {
  DEFAULT_SHARED_BUDGET_CHARS,
  SHARED_CHATS_KEY_PREFIX,
  SHARED_UNVERIFIED_NOTICE,
  buildSharedChatMessage,
  buildSharedRetrievalQuery,
  buildSharedSubject,
  sharedChatsKey,
  toAgentHistory,
  type SharedChatSubject,
} from "./shared-chat";

// ── 素材 ──

const DICT: Record<string, string> = {
  "library.tab.note": "ノート",
  "library.tab.knowledge": "知識",
  "library.tab.template": "テンプレート",
  "asset.type.url": "URL",
  "library.untitled": "（無題）",
  "library.unknownAuthor": "（不明）",
};
const uiT = (key: string) => DICT[key] ?? key;

const entry = (over: Partial<SharedEntry>): SharedEntry =>
  ({
    id: "0195e000-0000-7000-8000-000000000001",
    type: "note",
    author: { name: "湯川", email: "y@example.com" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    hash: "sha256:abc",
    prov: { derived_from: [] },
    extra: { title: "焼結の記録" },
    ...over,
  }) as SharedEntry;

const paragraph = (id: string, text: string) => ({
  id,
  type: "paragraph",
  content: [{ type: "text", text, styles: {} }],
});

/** 共有ノート JSON。AI に渡してはいけない chats・来歴も入れておく */
const noteBody = JSON.stringify({
  version: 6,
  title: "焼結の記録",
  createdAt: "2026-01-01T00:00:00Z",
  modifiedAt: "2026-01-02T00:00:00Z",
  pages: [
    {
      id: "p1",
      title: "焼結の記録",
      blocks: [paragraph("b1", "1200 度で 3 時間保持した。")],
    },
  ],
  chats: [
    {
      id: "c1",
      scopeBlockId: "b1",
      scopeType: "page",
      messages: [{ role: "user", content: "共有した覚えのない会話", timestamp: "" }],
    },
  ],
  documentProvenance: { revisions: [{ id: "r1", note: "秘密の来歴" }] },
});

/** pages[].blocks だけを読む簡易 Markdown 変換（実物と同じ入口の狭さを再現する） */
const blocksOnlyToMarkdown = async (doc: GraphiumDocument): Promise<string> =>
  (doc.pages ?? [])
    .flatMap((p) => (p.blocks ?? []) as any[])
    .map((b) => (b.content ?? []).map((c: any) => c.text ?? "").join(""))
    .join("\n");

// ── buildSharedSubject ──

describe("buildSharedSubject", () => {
  it("note は本文を Markdown 化し、題名・種別・作者を添える（表もそのまま渡る）", async () => {
    const markdown = "| 温度 | 保持時間 |\n| --- | --- |\n| 1200 | 3 |";
    const toMarkdown = vi.fn(async (_doc: GraphiumDocument) => markdown);
    const subject = await buildSharedSubject(entry({}), noteBody, { toMarkdown, uiT });

    expect(subject).not.toBeNull();
    expect(subject!.title).toBe("焼結の記録");
    expect(subject!.typeLabel).toBe("ノート");
    expect(subject!.author).toBe("湯川");
    expect(subject!.text).toBe(markdown);
    expect(subject!.truncated).toBe(false);
    // 変換に渡るのはパース済みの GraphiumDocument
    expect(toMarkdown).toHaveBeenCalledTimes(1);
    expect((toMarkdown.mock.calls[0][0].pages[0].blocks[0] as any).id).toBe("b1");
  });

  it("共有ノートの chats・来歴は AI に渡らない（pages[].blocks だけ）", async () => {
    const subject = await buildSharedSubject(entry({}), noteBody, {
      toMarkdown: blocksOnlyToMarkdown,
      uiT,
    });
    expect(subject!.text).toContain("1200 度で 3 時間保持した。");
    expect(subject!.text).not.toContain("共有した覚えのない会話");
    expect(subject!.text).not.toContain("秘密の来歴");
  });

  it("knowledge も note と同じ経路で Markdown 化する", async () => {
    const subject = await buildSharedSubject(
      entry({ type: "knowledge", extra: { title: "乾燥剤の知見" } }),
      noteBody,
      { toMarkdown: blocksOnlyToMarkdown, uiT },
    );
    expect(subject!.typeLabel).toBe("知識");
    expect(subject!.title).toBe("乾燥剤の知見");
    expect(subject!.text).toContain("1200 度で 3 時間保持した。");
  });

  it("template は擬似ドキュメントに包んでから Markdown 化する", async () => {
    const templateBody = JSON.stringify({
      name: "実験ノートの雛形",
      savedAt: "2026-02-01T00:00:00Z",
      pageTitle: "実験",
      blocks: [paragraph("t1", "手順をここに書く")],
      labels: [["t1", "step"]],
      attributes: [],
      tableMeta: { t2: { name: "測定値" } },
    });
    const toMarkdown = vi.fn(async (_doc: GraphiumDocument) => "手順をここに書く");
    const subject = await buildSharedSubject(
      entry({ type: "template", extra: { title: "実験ノートの雛形" } }),
      templateBody,
      { toMarkdown, uiT },
    );

    expect(subject!.typeLabel).toBe("テンプレート");
    const doc = toMarkdown.mock.calls[0][0];
    const page = doc.pages[0] as any;
    expect(doc.title).toBe("実験ノートの雛形");
    expect(doc.pages).toHaveLength(1);
    expect(page.title).toBe("実験");
    expect(page.blocks[0].id).toBe("t1");
    // 表のふるまいも落とさない（雛形として一番効く情報）
    expect(page.tableMeta).toEqual({ t2: { name: "測定値" } });
  });

  it("reference は URL・ドメイン・説明の箇条書きになる", async () => {
    const subject = await buildSharedSubject(
      entry({
        type: "reference",
        extra: {
          title: "焼結の総説",
          url: "https://example.com/sintering",
          domain: "example.com",
          description: "焼結のレビュー論文",
        },
      }),
      new Uint8Array(),
      { toMarkdown: blocksOnlyToMarkdown, uiT },
    );

    expect(subject!.typeLabel).toBe("URL");
    expect(subject!.text).toBe(
      ["- URL: https://example.com/sintering", "- ドメイン: example.com", "- 説明: 焼結のレビュー論文"].join("\n"),
    );
  });

  it("report は本文をテキストとしてそのまま渡す（Uint8Array でも読める）", async () => {
    const subject = await buildSharedSubject(
      entry({ type: "report", extra: { title: "週報" } }),
      new TextEncoder().encode("今週の進捗\n- 焼結を 3 本"),
      { toMarkdown: blocksOnlyToMarkdown, uiT },
    );
    expect(subject!.text).toBe("今週の進捗\n- 焼結を 3 本");
  });

  it("data-manifest と comment は対象外（null）", async () => {
    const opts = { toMarkdown: blocksOnlyToMarkdown, uiT };
    expect(await buildSharedSubject(entry({ type: "data-manifest" }), noteBody, opts)).toBeNull();
    expect(await buildSharedSubject(entry({ type: "comment" }), "指摘です", opts)).toBeNull();
  });

  it("読めない本文・中身が空の本文は null（空の本文で質問させない）", async () => {
    const opts = { toMarkdown: blocksOnlyToMarkdown, uiT };
    expect(await buildSharedSubject(entry({}), "これは JSON ではない", opts)).toBeNull();
    expect(await buildSharedSubject(entry({ type: "report" }), "   \n  ", opts)).toBeNull();
    expect(
      await buildSharedSubject(entry({ type: "template" }), "{}", opts),
    ).toBeNull();
  });

  it("題名・作者が無ければ辞書の代替表記になる", async () => {
    const subject = await buildSharedSubject(
      entry({ type: "report", extra: {}, author: { name: "", email: "" } as any }),
      "本文",
      { toMarkdown: blocksOnlyToMarkdown, uiT },
    );
    expect(subject!.title).toBe("（無題）");
    expect(subject!.author).toBe("（不明）");
  });

  it("予算を超えた本文は行の切れ目で切り、切ったことを本文に明示する", async () => {
    // 1 行 10 文字（改行込み 11 文字）× 10 行
    const lines = Array.from({ length: 10 }, (_, i) => `${i}`.repeat(10));
    const subject = await buildSharedSubject(
      entry({ type: "report", extra: { title: "長い報告" } }),
      lines.join("\n"),
      { toMarkdown: blocksOnlyToMarkdown, uiT, budgetChars: 35 },
    );

    expect(subject!.truncated).toBe(true);
    const body = subject!.text.split("\n");
    // 10 + 11 + 11 = 32 まで入り、4 行目（43 文字）は入らない
    expect(body.slice(0, 3)).toEqual(lines.slice(0, 3));
    // 行の途中では切れていない
    for (const line of body.slice(0, 3)) expect(line).toHaveLength(10);
    expect(body[3]).toBe("…（本文はここまでで打ち切り。全 109 文字中 32 文字）");
  });

  it("予算に収まる本文は切らない（既定は 20,000 字）", async () => {
    const text = "あ".repeat(DEFAULT_SHARED_BUDGET_CHARS);
    const subject = await buildSharedSubject(
      entry({ type: "report", extra: { title: "ちょうど" } }),
      text,
      { toMarkdown: blocksOnlyToMarkdown, uiT },
    );
    expect(subject!.truncated).toBe(false);
    expect(subject!.text).toBe(text);
  });

  it("1 行が予算を超える本文は文字数で切る（切ったことは明示する）", async () => {
    const subject = await buildSharedSubject(
      entry({ type: "report", extra: { title: "一行" } }),
      "あ".repeat(100),
      { toMarkdown: blocksOnlyToMarkdown, uiT, budgetChars: 20 },
    );
    expect(subject!.truncated).toBe(true);
    expect(subject!.text.split("\n")[0]).toBe("あ".repeat(20));
  });
});

// ── buildSharedChatMessage ──

const subject: SharedChatSubject = {
  title: "焼結の記録",
  typeLabel: "ノート",
  author: "湯川",
  text: "# 条件\n\n1200 度で 3 時間保持した。",
  truncated: false,
};

describe("buildSharedChatMessage", () => {
  it("初回は作者入りの前置きと本文を添える", () => {
    const message = buildSharedChatMessage({
      subject,
      question: "保持時間は妥当ですか",
      isFirstMessage: true,
      verified: true,
    });

    expect(message).toContain(
      "以下は共有ライブラリのノート「焼結の記録」（作者: 湯川）の内容です。この内容について質問があります。",
    );
    expect(message).toContain(subject.text);
    expect(message.endsWith("保持時間は妥当ですか")).toBe(true);
    expect(message).not.toContain(SHARED_UNVERIFIED_NOTICE);
  });

  it("継続は参照用の前置きになる（作者は繰り返さない）", () => {
    const message = buildSharedChatMessage({
      subject,
      question: "焼結温度は",
      isFirstMessage: false,
      verified: true,
    });

    expect(message).toContain("以下は共有ライブラリのノート「焼結の記録」の内容です（参照用）。");
    expect(message).not.toContain("作者: 湯川");
  });

  it("段落引用があれば引用が主題・本文が背景の 2 層になる", () => {
    const message = buildSharedChatMessage({
      subject,
      question: "ここはどういう意味ですか",
      isFirstMessage: true,
      quotedMarkdown: "1200 度で 3 時間保持した。",
      verified: true,
    });

    expect(message).toContain(
      "共有ライブラリのノート「焼結の記録」（作者: 湯川）の以下の内容について質問があります。",
    );
    expect(message).toContain("回答の主題はあくまで上の引用部分です。");
    expect(message).toContain(subject.text);
    // 引用なしの前置きは混ざらない
    expect(message).not.toContain("この内容について質問があります。\n");
  });

  it("引用チャットの継続では引用の前置きを繰り返さない", () => {
    const message = buildSharedChatMessage({
      subject,
      question: "他の条件は",
      isFirstMessage: false,
      quotedMarkdown: "1200 度で 3 時間保持した。",
      verified: true,
    });

    expect(message).not.toContain("以下の内容について質問があります。");
    expect(message).toContain("回答の主題はあくまで最初に引用した部分です。");
  });

  it("引用が本文と同じなら背景を二重に送らない", () => {
    const message = buildSharedChatMessage({
      subject,
      question: "要約して",
      isFirstMessage: true,
      quotedMarkdown: subject.text,
      verified: true,
    });
    expect(message.split(subject.text)).toHaveLength(2);
    expect(message).not.toContain("参考として、引用元の");
  });

  it("ハッシュ照合できていない本文には断りを 1 行足す", () => {
    const message = buildSharedChatMessage({
      subject,
      question: "内容を教えて",
      isFirstMessage: true,
      verified: false,
    });
    expect(message.startsWith(SHARED_UNVERIFIED_NOTICE)).toBe(true);
  });
});

// ── buildSharedRetrievalQuery ──

describe("buildSharedRetrievalQuery", () => {
  const tableSubject: SharedChatSubject = {
    title: "焼結の記録",
    typeLabel: "ノート",
    author: "湯川",
    text: [
      "# 焼結条件",
      "",
      "| 温度 | 保持時間 |",
      "| --- | --- |",
      "| 1200 | 3 |",
      "| 1300 | 5 |",
    ].join("\n"),
    truncated: false,
  };

  it("引用なしは題名と主題（見出し・列名）だけを使い、本文の数値行は混ぜない", () => {
    const query = buildSharedRetrievalQuery({ subject: tableSubject, question: "妥当ですか" });

    expect(query).toContain("焼結の記録");
    expect(query).toContain("焼結条件");
    expect(query).toContain("温度 / 保持時間");
    expect(query).toContain("妥当ですか");
    expect(query).not.toContain("1200");
    expect(query).not.toContain("1300");
  });

  it("引用ありは引用と質問だけを使う（背景の本文は混ぜない）", () => {
    const query = buildSharedRetrievalQuery({
      subject: tableSubject,
      question: "ここは何ですか",
      quotedMarkdown: "保持時間の定義",
    });

    expect(query).toBe("保持時間の定義\n\nここは何ですか");
    expect(query).not.toContain("焼結条件");
  });
});

// ── toAgentHistory ──

describe("toAgentHistory", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "保持時間は", timestamp: "2026-03-01T00:00:00Z" },
    { role: "assistant", content: "3 時間です", timestamp: "2026-03-01T00:00:01Z" },
  ];

  it("表示用の会話を role/content だけの形に写す", () => {
    expect(toAgentHistory(messages)).toEqual([
      { role: "user", content: "保持時間は" },
      { role: "assistant", content: "3 時間です" },
    ]);
  });

  it("引用チャットは先頭の質問に引用を再注入する", () => {
    const history = toAgentHistory(messages, {
      subject,
      quotedMarkdown: "1200 度で 3 時間保持した。",
    });

    expect(history[0].content).toContain(
      "共有ライブラリのノート「焼結の記録」（作者: 湯川）の以下の内容について質問があります。",
    );
    expect(history[0].content).toContain("1200 度で 3 時間保持した。");
    expect(history[0].content.endsWith("保持時間は")).toBe(true);
    // 背景の本文は履歴に積まない（毎ターンの user message 側に載せる）
    expect(history[0].content).not.toContain("# 条件");
    expect(history[1]).toEqual({ role: "assistant", content: "3 時間です" });
  });
});

// ── 保存キー ──

describe("sharedChatsKey", () => {
  it("共有エントリごとに手元の appData キーを作る", () => {
    expect(SHARED_CHATS_KEY_PREFIX).toBe("shared-chats:");
    expect(sharedChatsKey("0195e000-0000-7000-8000-000000000001")).toBe(
      "shared-chats:0195e000-0000-7000-8000-000000000001",
    );
  });
});
