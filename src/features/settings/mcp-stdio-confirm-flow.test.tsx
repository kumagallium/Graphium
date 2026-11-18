// @vitest-environment jsdom
// stdio の MCP サーバーを足す前の確認の流れ。
// 断ったら一覧に足さない。承諾したら今までどおり足す。
// remote は確認を出さない。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { __setConfirmResponderForTest } from "../../ui/confirm-dialog";
import { confirmStdioCommands } from "./confirm-stdio";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} as Record<string, unknown> },
  Document: () => null,
  Page: () => null,
}));

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  (window as unknown as Record<string, unknown>).__TAURI__ = {};
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ models: [], default: null }),
    text: async () => "{}",
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  __setConfirmResponderForTest(null);
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).__TAURI__;
  localStorage.clear();
});

async function openPasteForm() {
  const { SettingsModal } = await import("./modal");
  render(
    <LocaleProvider>
      <SettingsModal isOpen onClose={() => {}} initialTab="ai" />
    </LocaleProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Add MCP server/ }));
  fireEvent.click(await screen.findByText(/Advanced setup/));
  return (await screen.findByPlaceholderText(/mcpServers/)) as HTMLTextAreaElement;
}

const STDIO_JSON = JSON.stringify({ mcpServers: { demo: { command: "npx", args: ["-y", "demo mcp"], env: { TOKEN: "s3cret" } } } });
const REMOTE_JSON = JSON.stringify({ mcpServers: { r: { url: "https://example.com/mcp", type: "http" } } });

describe("設定 › MCP サーバー: stdio の確認", () => {
  it("断ると足されない（JSON 取り込みは接続テストを呼ばない）。出る文に command と env の名前があり値は無い", async () => {
    const responder = vi.fn(() => false);
    __setConfirmResponderForTest(responder);
    const textarea = await openPasteForm();
    fireEvent.change(textarea, { target: { value: STDIO_JSON } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(responder).toHaveBeenCalledTimes(1));
    const [message] = responder.mock.calls[0] as unknown as [string];
    expect(message).toContain('npx -y "demo mcp"');
    expect(message).toContain("env: TOKEN");
    expect(message).not.toContain("s3cret");
    // 断ったのでフォームは開いたまま・一覧に足されない
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByPlaceholderText(/mcpServers/)).not.toBeNull();
    expect(screen.queryByText("No MCP servers added yet.")).not.toBeNull();
  });

  it("承諾すると今までどおり足される", async () => {
    __setConfirmResponderForTest(() => true);
    const textarea = await openPasteForm();
    fireEvent.change(textarea, { target: { value: STDIO_JSON } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.queryByPlaceholderText(/mcpServers/)).toBeNull());
    expect(screen.queryByText("No MCP servers added yet.")).toBeNull();
  });

  it("remote は確認を出さずに足される", async () => {
    const responder = vi.fn(() => false);
    __setConfirmResponderForTest(responder);
    const textarea = await openPasteForm();
    fireEvent.change(textarea, { target: { value: REMOTE_JSON } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.queryByPlaceholderText(/mcpServers/)).toBeNull());
    expect(responder).not.toHaveBeenCalled();
  });
});

// 一覧に stdio を 1 件足してから、その編集を開く
async function addThenEdit(json: string) {
  __setConfirmResponderForTest(() => true);
  const textarea = await openPasteForm();
  fireEvent.change(textarea, { target: { value: json } });
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  await waitFor(() => expect(screen.queryByPlaceholderText(/mcpServers/)).toBeNull());
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  return (await screen.findByPlaceholderText(/mcpServers/)) as HTMLTextAreaElement;
}

function stdioJson(name: string, command: string, args: string[], env?: Record<string, string>) {
  return JSON.stringify({ mcpServers: { [name]: { command, args, ...(env ? { env } : {}) } } });
}

describe("設定 › MCP サーバー: JSON 編集での確認", () => {
  const BASE = stdioJson("demo", "npx", ["-y", "demo"], { TOKEN: "a" });

  it.each([
    ["command だけ変える", stdioJson("demo", "node", ["-y", "demo"], { TOKEN: "a" })],
    ["args だけ変える", stdioJson("demo", "npx", ["-y", "other"], { TOKEN: "a" })],
    ["env だけ変える", stdioJson("demo", "npx", ["-y", "demo"], { TOKEN: "b" })],
  ])("%s と確認が出る。断ると変わらない", async (_label, edited) => {
    const textarea = await addThenEdit(BASE);
    const responder = vi.fn(() => false);
    __setConfirmResponderForTest(responder);
    fireEvent.change(textarea, { target: { value: edited } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(responder).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    // 断ったので編集フォームは開いたまま
    expect(screen.queryByPlaceholderText(/mcpServers/)).not.toBeNull();
  });

  it("名前だけの変更では確認を出さない", async () => {
    const textarea = await addThenEdit(BASE);
    const responder = vi.fn(() => false);
    __setConfirmResponderForTest(responder);
    fireEvent.change(textarea, { target: { value: stdioJson("renamed", "npx", ["-y", "demo"], { TOKEN: "a" }) } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByPlaceholderText(/mcpServers/)).toBeNull());
    expect(responder).not.toHaveBeenCalled();
  });

  it("2 件目以降の新しい stdio だけが確認の対象になる（1 件目が変わらなければ含まれない）", async () => {
    const textarea = await addThenEdit(BASE);
    const responder = vi.fn(() => true);
    __setConfirmResponderForTest(responder);
    const two = JSON.stringify({
      mcpServers: {
        demo: { command: "npx", args: ["-y", "demo"], env: { TOKEN: "a" } },
        second: { command: "python3", args: ["srv.py"] },
      },
    });
    fireEvent.change(textarea, { target: { value: two } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(responder).toHaveBeenCalledTimes(1));
    const [message] = responder.mock.calls[0] as unknown as [string];
    expect(message).toContain("python3 srv.py");
    expect(message).not.toContain("npx");
  });
});

describe("設定 › MCP サーバー: 手入力フォームでの確認", () => {
  async function openManualForm() {
    await openPasteForm();
    fireEvent.click(screen.getByRole("button", { name: "Manual" }));
    return (await screen.findByPlaceholderText("npx")) as HTMLInputElement;
  }

  it("新規追加は確認が出る。断ると足されない・承諾すると足される", async () => {
    const responder = vi.fn(() => false);
    __setConfirmResponderForTest(responder);
    const command = await openManualForm();
    fireEvent.change(command, { target: { value: "uvx" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(responder).toHaveBeenCalledTimes(1));
    expect((responder.mock.calls[0] as unknown as [string])[0]).toContain("uvx");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("No MCP servers added yet.")).not.toBeNull();

    __setConfirmResponderForTest(() => true);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.queryByText("No MCP servers added yet.")).toBeNull());
  });

  it("編集は command を変えると確認が出て、名前だけの変更では出ない", async () => {
    __setConfirmResponderForTest(() => true);
    const textarea = await openPasteForm();
    fireEvent.change(textarea, { target: { value: stdioJson("demo", "npx", ["-y", "demo"]) } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.queryByPlaceholderText(/mcpServers/)).toBeNull());

    // 名前だけ変える
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Manual" }));
    const responder = vi.fn(() => true);
    __setConfirmResponderForTest(responder);
    const nameInput = (await screen.findAllByRole("textbox")).find(
      (el) => (el as HTMLInputElement).value === "demo",
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "demo2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByPlaceholderText("npx")).toBeNull());
    expect(responder).not.toHaveBeenCalled();

    // command を変える
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Manual" }));
    const command = (await screen.findByPlaceholderText("npx")) as HTMLInputElement;
    fireEvent.change(command, { target: { value: "node" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(responder).toHaveBeenCalledTimes(1));
    expect((responder.mock.calls[0] as unknown as [string])[0]).toContain("node");
  });
});

describe("confirmStdioCommands: 値の差し込み", () => {
  it("引数の $& や $1 が解釈されず、そのまま確認文に入る", async () => {
    const responder = vi.fn(() => true);
    __setConfirmResponderForTest(responder);
    await confirmStdioCommands([
      { type: "stdio", id: "x", name: "x", command: "sh", args: ["-c", "echo $& $1 $$"], enabled: true },
    ]);
    const [message] = responder.mock.calls[0] as unknown as [string];
    expect(message).toContain('sh -c "echo $& $1 $$"');
  });
});
