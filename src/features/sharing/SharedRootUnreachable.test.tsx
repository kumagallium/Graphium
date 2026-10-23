// @vitest-environment jsdom
// 共有フォルダに到達できないときの案内のテスト。
//
// 対象の不変条件:
// - 控えてある接続先があれば「再接続」が出て、押すと OS に頼み → 見えたら自動で読み直す
// - 見えるようにならなければ「まだ見えません」を出し、読み直さない
// - 控えが無ければ「再接続」は出さず、手で開き直す案内だけ出す
// - 別名マウントの候補は「このパスを使う」で採用できる
// - Library 側: 読み込みエラーが到達不能と診断されたときだけこの案内に置き換わる

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { SharedRootUnreachable } from "./SharedRootUnreachable";
import type { SharedRootDiagnosis } from "../../lib/storage/shared";

const ROOT = "/Volumes/Kumagai/graphium_commons";

function renderPanel(
  diagnosis: SharedRootDiagnosis,
  deps: {
    onReload?: () => void;
    onUseAlternative?: (p: string) => void;
    reconnect?: (remote: string) => Promise<void>;
    waitUntilReachable?: (root: string) => Promise<boolean>;
  } = {},
) {
  return render(
    <LocaleProvider>
      <SharedRootUnreachable
        root={ROOT}
        diagnosis={diagnosis}
        onReload={deps.onReload ?? (() => {})}
        onUseAlternative={deps.onUseAlternative}
        reconnect={deps.reconnect ?? (async () => {})}
        waitUntilReachable={deps.waitUntilReachable ?? (async () => true)}
      />
    </LocaleProvider>,
  );
}

afterEach(() => cleanup());

describe("SharedRootUnreachable", () => {
  it("reconnects via the remembered address and reloads once the root is visible", async () => {
    const reconnect = vi.fn(async () => {});
    const onReload = vi.fn();
    renderPanel(
      { reachable: false, alternatives: [], remote: "smb://nas.local/Kumagai" },
      { reconnect, onReload },
    );
    const btn = screen.getByRole("button", { name: /smb:\/\/nas\.local\/Kumagai/ });
    fireEvent.click(btn);
    await waitFor(() => expect(reconnect).toHaveBeenCalledWith("smb://nas.local/Kumagai"));
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
  });

  it("reports a timeout instead of reloading when the root never shows up", async () => {
    const onReload = vi.fn();
    renderPanel(
      { reachable: false, alternatives: [], remote: "\\\\nas\\Kumagai" },
      { onReload, waitUntilReachable: async () => false },
    );
    fireEvent.click(screen.getByRole("button", { name: /nas\\Kumagai/ }));
    await screen.findByText(/Still not visible|まだ見えません/);
    expect(onReload).not.toHaveBeenCalled();
  });

  it("offers only manual guidance when no address is remembered", () => {
    renderPanel({ reachable: false, alternatives: [], remote: null });
    expect(screen.queryByRole("button", { name: /Reconnect|再接続/ })).toBeNull();
    expect(screen.getByText(/No remembered address|接続先の控え/)).toBeTruthy();
  });

  it("lets the user adopt a sibling-volume alternative", () => {
    const onUseAlternative = vi.fn();
    const alt = "/Volumes/Kumagai-1/graphium_commons";
    renderPanel(
      { reachable: false, alternatives: [alt], remote: null },
      { onUseAlternative },
    );
    expect(screen.getByText(alt)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Use this path|このパスを使う/ }));
    expect(onUseAlternative).toHaveBeenCalledWith(alt);
  });
});

// ── Library 側の切り替え ──────────────────────────────────────────────────
// 読み込みエラーのうち、診断で「届いていない」と分かったものだけがこの案内になる。
// 届いているのに失敗した（権限など）ときは従来どおり原文のエラーを出す。

vi.mock("react-pdf", () => ({ Document: () => null, Page: () => null, pdfjs: { GlobalWorkerOptions: {} } }));
vi.mock("../../lib/pdfjs-config", () => ({}));

import { SharedLibraryView } from "./SharedLibraryView";
import type { SharedLibraryLoadResult } from "./shared-library-loader";

const FAILED: SharedLibraryLoadResult = {
  entries: { note: [], reference: [], "data-manifest": [], template: [], knowledge: [], report: [], proposal: [], comment: [] },
  errors: { note: "共有フォルダに到達できません: /Volumes/Kumagai/graphium_commons (os error 2)" },
};

function renderLibrary(diagnose: (root: string) => Promise<SharedRootDiagnosis>) {
  return render(
    <LocaleProvider>
      <SharedLibraryView
        sharedRoot={ROOT}
        currentIdentity={null}
        onForkNote={async () => {}}
        onForkKnowledge={async () => {}}
        onUnshare={async () => {}}
        onBack={() => {}}
        loadEntries={async () => FAILED}
        diagnose={diagnose}
        readEntryBody={async () => ({ body: new Uint8Array(), verified: true })}
      />
    </LocaleProvider>,
  );
}

describe("SharedLibraryView × unreachable root", () => {
  it("swaps the generic load error for the reconnect panel when the root is unreachable", async () => {
    renderLibrary(async () => ({ reachable: false, alternatives: [], remote: "smb://nas.local/Kumagai" }));
    await screen.findByTestId("shared-root-unreachable");
    expect(screen.queryByText(/Failed to load|読み込みに失敗/)).toBeNull();
  });

  it("keeps the original error when the root is reachable (e.g. a permission problem)", async () => {
    renderLibrary(async () => ({ reachable: true, alternatives: [], remote: null }));
    await screen.findByText(/Failed to load|読み込みに失敗/);
    expect(screen.queryByTestId("shared-root-unreachable")).toBeNull();
  });
});
