// 外部ツール（MCP サーバー）をつなぐ画面。ストーリー

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocale } from "../../../i18n";
import { CURATED_SERVERS, curatedText, curatedToOption } from "./catalog";
import { McpKeyView, McpPickView, type McpKeyViewProps, type McpPickViewProps } from "./McpConnectView";
import { toRegistryResults } from "./registry";

const frame = (Story: () => React.ReactElement) => (
  <div className="w-[560px] rounded-lg border border-primary/30 bg-primary/5 p-4">
    <Story />
  </div>
);

const meta: Meta = {
  title: "Molecules/McpConnect",
  decorators: [frame],
};
export default meta;

const noop = () => {};
const pickArgs = {
  query: "",
  search: { kind: "idle" as const },
  existingNames: [],
  onQueryChange: noop,
  onSearch: noop,
  onPickCurated: noop,
  onPickRegistry: noop,
  onOpenUrl: noop,
  onAdvanced: noop,
  onCancel: noop,
};

// 2026-11-04 に公式レジストリが返した形を縮めたもの
const results = toRegistryResults([
  { server: { name: "io.github.tavily-ai/tavily-mcp", title: "Tavily", description: "Search the web with Tavily.", packages: [{ registryType: "npm", identifier: "tavily-mcp" }] } },
  { server: { name: "ai.exa/exa", title: "Exa", description: "Search the web for any topic and get clean, ready-to-use content.", websiteUrl: "https://exa.ai", remotes: [{ type: "streamable-http", url: "https://mcp.exa.ai/mcp" }] } },
  { server: { name: "io.github.pipeworx-io/tavily", title: "Tavily", description: "Tavily MCP — wraps the Tavily API (tavily.com)", remotes: [{ type: "streamable-http", url: "https://gateway.pipeworx.io/tavily/mcp" }] } },
]);

/** 厳選の接続先の説明は画面の言語で出す（マニュアルの図は英語で撮る） */
function Pick(props: Partial<McpPickViewProps>) {
  const { locale } = useLocale();
  const curated = CURATED_SERVERS.map((server) => ({ server, text: curatedText(server, locale) }));
  return <McpPickView {...pickArgs} curated={curated} {...props} />;
}

/** 1 枚目: 厳選の接続先と、まだ探していない検索欄 */
export const PickStart: StoryObj = { render: () => <Pick /> };

/** 1 枚目: 公式レジストリを探したところ（繋げるもの → Node.js が要るものの順） */
export const PickSearched: StoryObj = {
  render: () => <Pick query="search" search={{ kind: "done", results }} />,
};

/** 1 枚目: Tavily は追加済み */
export const PickAdded: StoryObj = { render: () => <Pick existingNames={["tavily"]} /> };

const tavily = CURATED_SERVERS.find((s) => s.id === "tavily")!;
const keyArgs = {
  signupUrl: tavily.signupUrl,
  values: {},
  phase: { kind: "idle" as const },
  canConnect: false,
  onValueChange: noop,
  onOpenUrl: noop,
  onBack: noop,
  onConnect: noop,
};

/** 厳選の接続先（Tavily）のキーの画面。説明は画面の言語で出す */
function Key(props: Partial<McpKeyViewProps>) {
  const { locale } = useLocale();
  return <McpKeyView {...keyArgs} option={curatedToOption(tavily, locale)} {...props} />;
}

/** 2 枚目: キーを貼る前 */
export const KeyStart: StoryObj = { render: () => <Key /> };

/** 2 枚目: 確かめている途中 */
export const KeyTesting: StoryObj = {
  render: () => <Key values={{ Authorization: "tvly-xxxxxxxx" }} canConnect phase={{ kind: "testing" }} />,
};

/** 2 枚目: つながらなかった */
export const KeyError: StoryObj = {
  render: () => (
    <Key values={{ Authorization: "tvly-xxxxxxxx" }} canConnect phase={{ kind: "error", message: "Connection timeout" }} />
  ),
};

/** 2 枚目: 確かめる口でキーが違うと分かった */
export const KeyInvalid: StoryObj = {
  render: () => <Key values={{ Authorization: "tvly-wrong" }} canConnect phase={{ kind: "invalidKey" }} />,
};

/** 2 枚目: キーの要らない接続先（公式レジストリの Exa） */
export const KeyNotNeeded: StoryObj = {
  render: () => {
    const exa = results.find((r) => r.kind === "remote");
    return exa?.kind === "remote" ? <Key option={exa.option} signupUrl={undefined} canConnect /> : <></>;
  },
};
