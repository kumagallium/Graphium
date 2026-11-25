// @vitest-environment jsdom
// 接続を配るファイル: 書き出し → 読み込みの往復と、読み込みの確認画面の守り

import { describe, it, expect, vi, afterEach } from "vitest";

vi.hoisted(() => localStorage.setItem("graphium_locale", "ja"));
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../../i18n";
import { ConnectionFileExport, type ExportableGroup } from "./ConnectionFileExport";
import { ConnectionFileImport, type ImportModelSpec } from "./ConnectionFileImport";
import { buildConnectionFile, parseConnectionFileText, type ConnectionFile } from "./format";

afterEach(cleanup);

const GROUP: ExportableGroup = {
  id: "openai-compatible::http://lab-ws.example.test:8000/v1",
  label: "OpenAI Compatible (http://lab-ws.example.test:8000/v1)",
  provider: "openai-compatible",
  apiBase: "http://lab-ws.example.test:8000/v1",
  models: [
    { name: "研究室のサーバー", modelId: "local-model-a" },
    { name: "研究室のサーバー（大）", modelId: "local-model-b" },
  ],
};

/** 書き出しの画面を操作して、保存されたファイルの中身を受け取る */
async function exportWith(steps: () => void): Promise<string> {
  let saved: Blob | null = null;
  render(
    <LocaleProvider>
      <ConnectionFileExport
        groups={[GROUP]}
        defaultFrom="熊谷"
        iterations={100_000}
        save={async (blob) => {
          saved = blob;
          return true;
        }}
        onClose={() => {}}
      />
    </LocaleProvider>,
  );
  steps();
  fireEvent.click(screen.getByRole("button", { name: /書き出す/ }));
  await waitFor(() => expect(saved).not.toBeNull());
  return (saved as unknown as Blob).text();
}

function renderImport(file: ConnectionFile, importModels = vi.fn(async (_: ImportModelSpec[]) => {})) {
  render(
    <LocaleProvider>
      <ConnectionFileImport
        existing={[]}
        importModels={importModels}
        keylessPlaceholder="local"
        onBack={() => {}}
        initialFile={file}
      />
    </LocaleProvider>,
  );
  return importModels;
}

describe("書き出し", () => {
  it("キーを入れない形で書き出せる", async () => {
    const text = await exportWith(() => {});
    const f = parseConnectionFileText(text);
    expect(f.from).toBe("熊谷");
    expect(f.key).toBeUndefined();
    expect(f.connection.models.map((m) => m.modelId)).toEqual(["local-model-a", "local-model-b"]);
  });

  it("キーを入れると既定で暗号化され、ファイルにキーがそのまま現れない", async () => {
    const text = await exportWith(() => {
      fireEvent.click(screen.getByLabelText("入れる"));
      const pw = screen.getAllByDisplayValue("");
      // キー・パスフレーズ・もう一度 の順に並ぶ password 欄
      const passwords = pw.filter((el) => (el as HTMLInputElement).type === "password");
      fireEvent.change(passwords[0], { target: { value: "dummy-key-123" } });
      fireEvent.change(passwords[1], { target: { value: "correct horse" } });
      fireEvent.change(passwords[2], { target: { value: "correct horse" } });
    });
    expect(text).not.toContain("dummy-key-123");
    expect(parseConnectionFileText(text).key).toHaveProperty("encrypted");
  });

  it("パスフレーズが一致しないと書き出せない", () => {
    render(
      <LocaleProvider>
        <ConnectionFileExport groups={[GROUP]} save={async () => true} onClose={() => {}} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByLabelText("入れる"));
    const passwords = screen.getAllByDisplayValue("").filter((el) => (el as HTMLInputElement).type === "password");
    fireEvent.change(passwords[0], { target: { value: "dummy-key-123" } });
    fireEvent.change(passwords[1], { target: { value: "correct horse" } });
    fireEvent.change(passwords[2], { target: { value: "correct house" } });
    expect(screen.getByText("パスフレーズが一致しません。")).toBeTruthy();
    expect((screen.getByRole("button", { name: /書き出す/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("読み込み", () => {
  it("送り先のホスト名と http の注意を、読み込む前に見せる", () => {
    renderImport(buildConnectionFile({ provider: GROUP.provider, apiBase: GROUP.apiBase, models: GROUP.models, from: "熊谷" }));
    expect(screen.getByText("lab-ws.example.test:8000")).toBeTruthy();
    expect(screen.getByText(/暗号化されない http/)).toBeTruthy();
    expect(screen.getByText("熊谷")).toBeTruthy();
  });

  it("キーの無いファイルは、中身の無い値でまとめて登録する", async () => {
    const importModels = renderImport(buildConnectionFile({ provider: GROUP.provider, apiBase: GROUP.apiBase, models: GROUP.models }));
    fireEvent.click(screen.getByRole("button", { name: /^読み込む$/ }));
    await waitFor(() => expect(importModels).toHaveBeenCalledTimes(1));
    const specs = importModels.mock.calls[0][0];
    expect(specs.map((s) => s.modelId)).toEqual(["local-model-a", "local-model-b"]);
    expect(specs.every((s) => s.apiKey === "local" && s.apiBase === GROUP.apiBase)).toBe(true);
  });

  it("書き出した暗号化ファイルを、正しいパスフレーズで読み込める。違えば登録しない", async () => {
    const text = await exportWith(() => {
      fireEvent.click(screen.getByLabelText("入れる"));
      const passwords = screen.getAllByDisplayValue("").filter((el) => (el as HTMLInputElement).type === "password");
      fireEvent.change(passwords[0], { target: { value: "dummy-key-123" } });
      fireEvent.change(passwords[1], { target: { value: "correct horse" } });
      fireEvent.change(passwords[2], { target: { value: "correct horse" } });
    });
    cleanup();
    const importModels = renderImport(parseConnectionFileText(text));
    const pass = screen.getAllByDisplayValue("").find((el) => (el as HTMLInputElement).type === "password")!;

    fireEvent.change(pass, { target: { value: "wrong horse!" } });
    fireEvent.click(screen.getByRole("button", { name: /^読み込む$/ }));
    await screen.findByText(/パスフレーズが違うか/);
    expect(importModels).not.toHaveBeenCalled();

    fireEvent.change(pass, { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: /^読み込む$/ }));
    await waitFor(() => expect(importModels).toHaveBeenCalledTimes(1));
    expect(importModels.mock.calls[0][0][0].apiKey).toBe("dummy-key-123");
  });
});
