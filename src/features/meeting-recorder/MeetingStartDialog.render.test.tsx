// @vitest-environment jsdom
// 開始ダイアログのモデル未取得の文: 「始めると取得します」「取得しています」「未取得です（従来）」の切り替え

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import { MeetingStartDialog } from "./MeetingStartDialog";

afterEach(cleanup);

const text = (props: Partial<Parameters<typeof MeetingStartDialog>[0]>) => {
  render(
    <LocaleProvider>
      <MeetingStartDialog open permission={{ screen: "granted", mic: "granted" }} onStart={() => {}} onCancel={() => {}} {...props} />
    </LocaleProvider>,
  );
  return document.body.textContent ?? "";
};

describe("MeetingStartDialog のモデル未取得の文", () => {
  it("取得済みなら文を出さない", () => {
    const s = text({ modelMissing: false, modelDownloadMb: 574 });
    expect(s).not.toContain(t("meeting.modelMissingNotice"));
    expect(s).not.toContain(t("meeting.modelAutoDownloadNotice", { size: "574" }));
  });

  it("未取得で自動取得の対象なら、始めると取得する旨と大きさを出す", () => {
    const s = text({ modelMissing: true, modelDownloadMb: 574 });
    expect(s).toContain(t("meeting.modelAutoDownloadNotice", { size: "574" }));
  });

  it("すでに取得している最中なら「取得しています」の文", () => {
    const s = text({ modelMissing: true, modelDownloadMb: 574, modelDownloading: true });
    expect(s).toContain(t("meeting.modelDownloadingNotice", { size: "574" }));
    expect(s).not.toContain(t("meeting.modelAutoDownloadNotice", { size: "574" }));
  });

  it("自動では取得しない（取り消し・削除・失敗のあと）なら、従来の「未取得です」の文", () => {
    const s = text({ modelMissing: true, modelDownloadMb: null });
    expect(s).toContain(t("meeting.modelMissingNotice"));
  });
});
