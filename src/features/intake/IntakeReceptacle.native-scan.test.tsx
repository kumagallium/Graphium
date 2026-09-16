// @vitest-environment jsdom
// 受け皿のデスクトップ走査が、StrictMode の下でも画面に反映されるかのテスト
//
// 対象の不変条件:
// - 走査中に届いた件数が表示される
// - 走査が終わる（または停止で中止される）と受け皿が最初の表示に戻る
// - 見つかったファイルは onFilesSelected に渡る
//
// 開発ビルドの React は StrictMode でマウント → アンマウント → 再マウントを 1 回
// 行う。アンマウント判定のフラグを再マウントで戻し忘れると、以降の setState が
// すべて捨てられ、件数も出ず「停止」も効かないまま受け皿が固まる（実機で起きた）。
// それを捕まえるため、必ず StrictMode で包んで描画する。

import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import type { NativeScanOutcome, NativeScanOptions } from "./native-scan";
import type { IntakeFile } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 走査の完了を外から制御するための足場
let resolveScan: (outcome: NativeScanOutcome) => void = () => {};
let lastOptions: NativeScanOptions | null = null;
const cancelMock = vi.fn(async (_scanId: string) => {});

vi.mock("./native-scan", () => ({
  isNativeScanAvailable: () => true,
  pickFolderNative: async () => "/Volumes/NAS/work",
  createFolderScanId: () => "scan-1",
  scanFolderNative: (_root: string, opts: NativeScanOptions) => {
    lastOptions = opts;
    return new Promise<NativeScanOutcome>((resolve) => {
      resolveScan = resolve;
    });
  },
  cancelFolderScanNative: (scanId: string) => cancelMock(scanId),
}));

import { IntakeReceptacle } from "./IntakeReceptacle";

function fileAt(path: string): IntakeFile {
  const name = path.split("/").pop() ?? path;
  return { path, name, type: "", getFile: async () => new File(["x"], name) };
}

function renderReceptacle(onFilesSelected = vi.fn()) {
  const utils = render(
    <StrictMode>
      <LocaleProvider>
        <IntakeReceptacle onFilesSelected={onFilesSelected} />
      </LocaleProvider>
    </StrictMode>,
  );
  return { ...utils, onFilesSelected };
}

async function startScan(getByText: (text: string) => HTMLElement) {
  await act(async () => {
    fireEvent.click(getByText("Choose a folder"));
  });
  await waitFor(() => expect(lastOptions).not.toBeNull());
}

beforeEach(() => {
  localStorage.setItem("graphium_locale", "en");
  lastOptions = null;
  cancelMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("IntakeReceptacle のデスクトップ走査（StrictMode）", () => {
  it("走査中に届いた件数とフォルダ数を表示する", async () => {
    const { getByText, findByText } = renderReceptacle();
    await startScan(getByText);

    await act(async () => {
      lastOptions?.onProgress?.({ found: 1234, folders: 50 });
    });

    expect(await findByText("1234 found so far (50 folders checked)")).toBeTruthy();
    expect(getByText("Stop")).toBeTruthy();
  });

  it("ファイルが 0 件でもフォルダ数だけで進捗の行を出す（幅優先で浅い階層を巡っている間の固まって見える問題への対処）", async () => {
    const { getByText, findByText } = renderReceptacle();
    await startScan(getByText);

    await act(async () => {
      lastOptions?.onProgress?.({ found: 0, folders: 37 });
    });

    expect(await findByText("0 found so far (37 folders checked)")).toBeTruthy();
    expect(getByText("Stop")).toBeTruthy();
  });

  it("走査が終わると最初の表示に戻り、見つかったファイルを渡す", async () => {
    const { getByText, findByText, queryByText, onFilesSelected } = renderReceptacle();
    await startScan(getByText);

    const files = [fileAt("work/a.md"), fileAt("work/b.pdf")];
    await act(async () => {
      resolveScan({ files, truncated: false, cancelled: false });
    });

    expect(await findByText("Choose a folder")).toBeTruthy();
    expect(queryByText("Stop")).toBeNull();
    expect(onFilesSelected).toHaveBeenCalledWith(files, "folder");
  });

  it("停止を押すと自分の走査 ID で中止を送り、中止の結果で最初の表示に戻る", async () => {
    const { getByText, findByText, queryByText, onFilesSelected } = renderReceptacle();
    await startScan(getByText);

    await act(async () => {
      fireEvent.click(getByText("Stop"));
    });
    expect(cancelMock).toHaveBeenCalledWith("scan-1");

    await act(async () => {
      resolveScan({ files: [], truncated: false, cancelled: true });
    });

    expect(await findByText("Choose a folder")).toBeTruthy();
    expect(queryByText("Stop")).toBeNull();
    expect(onFilesSelected).not.toHaveBeenCalled();
  });
});
