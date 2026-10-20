// 会議の文字起こしブロックの登録エントリー・スラッシュメニュー・挿入 helper。

import type { CustomBlockEntry } from "../../base/schema";
import { t } from "../../i18n";
import { openConfirm } from "../../features/meeting-recorder/store";
import { MeetingTranscriptBlockSpec } from "./view";

export { buildTranscriptParagraphs } from "./expand";

export const meetingTranscriptBlock: CustomBlockEntry = {
  type: "meetingTranscript",
  spec: MeetingTranscriptBlockSpec,
};

// スラッシュメニュー項目。押すと録音の開始確認を開くだけで、ブロックの差し込みは
// 録音が始まった時点（MeetingRecorderMount → insertMeetingTranscriptBlock）で起きる。
// 録音はデスクトップ限定のため、組み込み側（slash-items）で isTauri() のときだけ加える。
export const meetingTranscriptSlashItem = {
  // ラベルは getter で遅延評価する（言語切替に追従させるため）
  get title() { return t("slash.meetingTranscript"); },
  get subtext() { return t("slash.meetingTranscriptSub"); },
  get group() { return t("slash.advancedGroup"); },
  onItemClick: () => {
    void openConfirm();
  },
  aliases: ["meeting", "record", "transcript", "会議", "かいぎ", "kaigi", "録音", "ろくおん", "文字起こし"],
};

export type MeetingTranscriptProps = {
  recordingId: string;
  fileId: string;
  startedAt: string;
};

/** ブロックの初期 props（durationMs などは既定値に任せる） */
export function buildMeetingTranscriptBlock(props: MeetingTranscriptProps) {
  return { type: "meetingTranscript" as const, props: { ...props } };
}

/**
 * カーソル位置の後ろに文字起こしブロックを挿入する。カーソル行が空（スラッシュコマンドの
 * 残骸のみ）ならその行を置き換える。挿入できたら true。
 */
export function insertMeetingTranscriptBlock(editor: any, props: MeetingTranscriptProps): boolean {
  // 読み取り専用のエディタには差し込まない（呼び出し側は新規ノートに倒す）
  if (!editor || editor.isEditable === false) return false;
  let currentBlock: any;
  try {
    currentBlock = editor.getTextCursorPosition().block;
  } catch {
    return false;
  }
  if (!currentBlock) return false;
  editor.insertBlocks([buildMeetingTranscriptBlock(props)], currentBlock, "after");
  const content = currentBlock.content;
  const isEmpty =
    Array.isArray(content) &&
    content.length <= 1 &&
    (!content[0] || (content[0].type === "text" && content[0].text.replace("/", "").trim() === ""));
  if (isEmpty) editor.removeBlocks([currentBlock]);
  return true;
}

/**
 * 録音 ID が一致する文字起こしブロックを、入れ子も含めて探して取り除く。
 * 何も録れなかった録音のブロックを片付けるのに使う。見つからない・読み取り専用なら何もせず false。
 */
export function removeMeetingTranscriptBlock(editor: any, recordingId: string): boolean {
  if (!editor || editor.isEditable === false || !recordingId) return false;
  const found: any[] = [];
  const walk = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (b?.type === "meetingTranscript" && b.props?.recordingId === recordingId) found.push(b);
      if (b?.children?.length) walk(b.children);
    }
  };
  walk(editor.document);
  if (found.length === 0) return false;
  editor.removeBlocks(found);
  return true;
}
