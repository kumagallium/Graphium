// stdio の MCP サーバーを足す前の確認（実行されるコマンドの表示）。
// 開いた状態から始める。長い引数・env（値は出さない）・制御文字の置き換え・複数件の並びを見る。

import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConfirmHost } from "../../ui/confirm-dialog";
import { Button } from "@ui/button";
import { confirmStdioCommands } from "./confirm-stdio";
import type { McpStdioServer } from "./store";

const server = (over: Partial<McpStdioServer>): McpStdioServer => ({
  type: "stdio",
  id: crypto.randomUUID(),
  name: "demo",
  command: "npx",
  args: [],
  enabled: true,
  ...over,
});

function Demo({ servers }: { servers: McpStdioServer[] }) {
  const [answer, setAnswer] = useState("—");
  const ask = async () => setAnswer(String(await confirmStdioCommands(servers)));
  useEffect(() => {
    void ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-3">
      <Button onClick={() => void ask()}>確認を開く</Button>
      <p className="text-xs text-muted-foreground">答え: {answer}</p>
      <ConfirmHost />
    </div>
  );
}

const meta: Meta<typeof Demo> = {
  title: "Features/Settings/ConfirmStdio",
  component: Demo,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof Demo>;

/** 1 件（env の値は出さない） */
export const Single: Story = {
  name: "1 件",
  args: {
    servers: [server({ args: ["-y", "tavily-mcp"], env: { TAVILY_API_KEY: "tvly-secret" } })],
  },
};

/** 長い引数（300 文字で切る）と、制御文字・双方向制御文字の置き換え */
export const LongAndControlChars: Story = {
  name: "長い引数・制御文字",
  args: {
    servers: [
      server({
        command: "sh",
        args: ["-c", "echo " + "a".repeat(400), "line1\nline2", "evil" + String.fromCharCode(0x202e) + "gpj.exe"],
      }),
    ],
  },
};

/** 複数件（サーバー名つきで全部並ぶ。長いと本文だけスクロールする） */
export const Many: Story = {
  name: "複数件（7 件）",
  args: {
    servers: Array.from({ length: 7 }, (_, i) => server({ name: `server-${i + 1}`, args: ["-y", `pkg-${i + 1}`] })),
  },
};
