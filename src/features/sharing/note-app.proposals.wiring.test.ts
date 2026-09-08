// ノート編集画面（note-app）から提案まわりの部品への配線のテスト。仕様 §25b B / F。
//
// note-app.tsx は単体で描画できる大きさではないので、SharedNoteView.wiring.test と
// 同じく **ソースの字面** で不変条件を守る。ここで見ているのはどれも
// 「配線を落としても部品側のテストでは気づけない」もの:
//
// - 提案タブは共有済み（sharedRef あり）かつ提案が 1 件以上あるときだけ出す
// - 比べる相手は共有コピーではなく、いま開いているノートの最新本文（resolveMine）
// - 取り込みの順序: 版を残す → 適用 → エディタ反映 → 注釈 → 来歴 → 保存
// - 来歴は proposal_adopt / force / sources: shared:<提案 id>
// - 派生元チップとグラフが共有エントリを開く入口（openSharedEntry）に繋がっている

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dirname, "..", "..", "note-app.tsx"), "utf-8");

/** 開始タグから最初の `/>` までを切り出す（属性の並びを見るため） */
function jsxOf(tag: string): string {
  const start = source.indexOf(`<${tag}`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("/>", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("提案タブの配線", () => {
  it("右レールのタブは共有済み + 提案 1 件以上のときだけ出す", () => {
    expect(source).toContain(
      'show: isTauri() && !!sharedRoot && !!sharedRefState && proposalCount > 0,',
    );
  });

  it("件数は数を返すフックで取る（スナップショットを購読するとノート本体が描き直される）", () => {
    expect(source).toContain("const proposalCount = useNoteProposalCount(");
  });

  it("パネルには手元の最新本文を組み立てる関数と取り込みハンドラを渡す", () => {
    const jsx = jsxOf("NoteProposalsPanel");
    expect(jsx).toContain("resolveMine={resolveProposalSource}");
    expect(jsx).toContain("onAdopt={handleAdoptProposal}");
    expect(jsx).toContain("targetId={sharedRefState.id}");
  });

  it("提案として共有しているノート自身には提案タブの件数を数えない", () => {
    // 自分が提案の封筒を指しているとき、その id に来ている提案は存在しない
    expect(source).toContain('!isProposalShared ? sharedRefState?.id : undefined');
  });
});

describe("取り込みの手順", () => {
  const body = (() => {
    const start = source.indexOf("const handleAdoptProposal = useCallback(");
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, start + 3200);
  })();

  it("まず版を残してから適用する（戻る場所を作る）", () => {
    const snapshotAt = body.indexOf("await handleTakeSnapshot()");
    const applyAt = body.indexOf("applyProposalChanges(");
    expect(snapshotAt).toBeGreaterThan(-1);
    expect(applyAt).toBeGreaterThan(snapshotAt);
  });

  it("本文は document 全体の replaceBlocks で入れる（undo 1 回で戻る）", () => {
    expect(body).toContain("editor.replaceBlocks(editor.document,");
  });

  it("ラベルと PROV リンクをストアへ反映する（次の保存で巻き戻さない）", () => {
    expect(body).toContain("applyAdoptedPageAnnotations({ labelStore, linkStore, page })");
  });

  it("来歴に proposal_adopt を force で 1 行残し、提案 id を sources に入れる", () => {
    expect(body).toContain('"proposal_adopt"');
    expect(body).toContain("force: true");
    expect(body).toContain("sources: [`shared:${request.proposalId}`]");
  });

  it("最後に保存を予約する", () => {
    const recordAt = body.indexOf('"proposal_adopt"');
    const dirtyAt = body.indexOf("markDirty();");
    expect(dirtyAt).toBeGreaterThan(recordAt);
  });
});

describe("派生元とグラフ（§25b F）", () => {
  it("ヘッダの派生元チップから元の共有エントリを開ける", () => {
    const jsx = jsxOf("NoteForkedFromChip");
    expect(jsx).toContain("forkedFrom={forkedFrom}");
    expect(jsx).toContain("onOpen={(sharedId) => openSharedEntry(sharedId)}");
  });

  it("グラフタブは共有由来ノードを足す部品を通す", () => {
    const jsx = jsxOf("NoteGraphTabPanel");
    expect(jsx).toContain("forkedFrom={forkedFrom}");
    expect(jsx).toContain("sharedRef={sharedRefState}");
    expect(jsx).toContain("onOpenSharedEntry=");
    expect(source).toContain("buildNoteSharedGraph({ forkedFrom, sharedRef }, noteId, shared.entries)");
  });

  it("派生元・提案があるときはグラフタブを出す（本文にリンクが無くても）", () => {
    expect(source).toContain("|| !!forkedFrom?.sharedId || proposalCount > 0 }");
  });
});

describe("基準版の控えの片付け（§25b C-3）", () => {
  it("提案を取り下げたら控えを消す", () => {
    expect(source).toContain("if (fileId) await clearForkBase(fileId);");
  });

  it("取り込み済みになったら控えを消す", () => {
    expect(source).toContain("onAdopted={fileId ? () => void clearForkBase(fileId) : undefined}");
  });
});

describe("共有ライブラリの提案から取り込みを始める（§25b B-6）", () => {
  it("全画面に取り込みの入口を渡す", () => {
    expect(jsxOf("SharedEntryFullView")).toContain("onAdoptInNote={handleAdoptProposalInNote}");
  });

  it("宛先の共有エントリ id から手元のノート id を引いてから移る", () => {
    expect(source).toContain("const noteId = await resolveSharedNoteId(input.targetId, {");
    // ノート遷移は navigateToNote が唯一の入口
    expect(source).toContain("navigateToNote(noteId);");
  });

  it("解決はボタンを押したときだけ走らせる（描画のたびに走査しない）", () => {
    // resolveSharedNoteId を呼ぶのはハンドラの中の 1 か所だけ
    expect(source.split("resolveSharedNoteId(").length - 1).toBe(1);
    expect(source).not.toContain("useMemo(() => resolveSharedNoteId");
  });

  it("手元にノートが無ければ移動せず短く案内する", () => {
    expect(source).toContain('showSharedNotice(tStatic("proposal.adopt.noteMissingToast"));');
  });

  it("共有した時点で「共有エントリ id → ノート id」を控える", () => {
    expect(source).toContain("void saveSharedNoteLink(result.doc.sharedRef.id, fileId);");
  });

  it("着地の指示は宛先のノートを開いている間だけ渡す", () => {
    expect(source).toContain(
      "proposalOpenRequest && proposalOpenRequest.noteId === fm.activeFileId",
    );
    expect(source).toContain("onProposalRequestHandled={() => setProposalOpenRequest(null)}");
  });

  it("指名された提案を開いた状態でパネルに着地する", () => {
    const jsx = jsxOf("NoteProposalsPanel");
    expect(jsx).toContain("initialProposalId={pendingProposalId ?? undefined}");
    expect(jsx).toContain("onInitialProposalOpened={() => setPendingProposalId(null)}");
  });
});
