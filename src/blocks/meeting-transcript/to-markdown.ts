// 会議の文字起こしブロック → Markdown（純ロジック）
//
// 読めている（ブロックが描画時にキャッシュした）ときは `[mm:ss] 相手: …` の行を並べる。
// 読めない・展開済みのときはヘッダー 1 行だけ（展開済みの発言は隣の段落として出る）。

import { t } from "../../i18n";
import { formatSegmentLine } from "../../features/meeting-recorder/transcript-format";
import { textParagraph, type BlockToMarkdown } from "../markdown-block";
import { recallTranscript } from "./transcript-cache";

export const meetingTranscriptToMarkdown: BlockToMarkdown = (block, ctx) => {
  const props = block.props ?? {};
  // 録音前（ready）のブロックには書き出す中身が無い
  if (!props.recordingId && !props.fileId) return ctx.children.length ? ctx.children : [];
  const header = t("meetingBlock.markdownHeader", { startedAt: String(props.startedAt ?? "") });
  const segments = props.expanded ? undefined : recallTranscript(String(props.fileId ?? ""));
  if (!segments || segments.length === 0) {
    // 発言は素材側にある。一括書き出し（ノートを開いていない）では読めないので、その旨を添える
    if (props.expanded) return [textParagraph(header, {}, ctx.children)];
    return [textParagraph(header), textParagraph(t("meetingBlock.exportHint"), {}, ctx.children)];
  }
  const labels = { other: t("meeting.trackOther"), self: t("meeting.trackSelf") };
  return [
    textParagraph(header),
    ...segments.map((s, i) =>
      textParagraph(formatSegmentLine(s, labels), {}, i === segments.length - 1 ? ctx.children : []),
    ),
  ];
};
