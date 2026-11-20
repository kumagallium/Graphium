// @vitest-environment jsdom
// データを選択（MediaPickerModal）: リンクした素材は挿入の形を link に寄せるが、
// 利用者が選んだ形（requestedMode）もそのまま渡す。リンクした CSV を「埋め込み」で選んだら
// 呼び出し側が表への取り込みに進めるようにするため（寄せた値だけだと判定できない）。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MediaPickerModal } from "./MediaPickerModal";
import { createEmptyIndex, type MediaIndexEntry } from "./media-index";
import { buildLinkedEntry } from "../linked-files/linked-entry";
import { LocaleProvider } from "../../i18n";

afterEach(cleanup);

const NOW = "2026-11-20T00:00:00.000Z";

function linkedCsv(): MediaIndexEntry {
  return buildLinkedEntry({
    picked: { placeId: "p", relPath: "dir/run.csv", name: "run.csv", size: 1, mtimeMs: 1 },
    place: { id: "p", name: "Lab" },
    now: NOW,
    fileId: "url_run",
  });
}

describe("MediaPickerModal: 挿入の形の受け渡し", () => {
  it("リンクした CSV を埋め込みで選ぶと、寄せた形は link・選んだ形は embed で渡る", () => {
    const entry = linkedCsv();
    const index = { ...createEmptyIndex(), media: [entry] };
    const onSelect = vi.fn();
    render(
      <LocaleProvider>
        <MediaPickerModal mediaIndex={index} mediaType="data" onSelect={onSelect} onClose={() => {}} allowDisplayMode />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByTitle("run.csv"));
    expect(onSelect).toHaveBeenCalledWith(entry, "link", "embed");
  });
});
