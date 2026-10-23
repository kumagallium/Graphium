// 共有フォルダに到達できないときの案内のストーリー。
//
// 研究室の NAS（/Volumes/Kumagai）がスリープ復帰で外れた場面。OS への再接続と
// 待ち受けは DI で差し替え、ボタンを押したときの遷移（待つ → 読み直す／まだ見えない）
// だけを見る。別名マウント（Kumagai-1）の候補付きも 1 本。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LocaleProvider } from "../../i18n";
import { SharedRootUnreachable } from "./SharedRootUnreachable";
import "../../app.css";

const ROOT = "/Volumes/Kumagai/graphium_commons";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const meta: Meta<typeof SharedRootUnreachable> = {
  title: "Sharing/SharedRootUnreachable",
  component: SharedRootUnreachable,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <LocaleProvider>
        <div className="max-w-xl">
          <Story />
        </div>
      </LocaleProvider>
    ),
  ],
  args: {
    root: ROOT,
    onReload: () => alert("reload"),
    reconnect: async () => {},
  },
};
export default meta;

type Story = StoryObj<typeof SharedRootUnreachable>;

/** 接続先を控えてある（2 回目以降）。再接続を押すと 1.5 秒待って読み直す */
export const WithRemote: Story = {
  args: {
    diagnosis: { reachable: false, alternatives: [], remote: "smb://kumagai@nas.local/Kumagai" },
    waitUntilReachable: async () => {
      await sleep(1500);
      return true;
    },
  },
};

/** 再接続を押しても見えるようにならない（Finder 側で資格情報の入力が止まっている等） */
export const ReconnectTimesOut: Story = {
  args: {
    diagnosis: { reachable: false, alternatives: [], remote: "smb://kumagai@nas.local/Kumagai" },
    waitUntilReachable: async () => {
      await sleep(1500);
      return false;
    },
  },
};

/** 初回（控えが無い）: 手で開き直す案内だけ */
export const NoRemote: Story = {
  args: {
    diagnosis: { reachable: false, alternatives: [], remote: null },
  },
};

/** 別名でマウントされている（/Volumes/Kumagai-1）: 候補と「このパスを使う」 */
export const SiblingVolume: Story = {
  args: {
    diagnosis: {
      reachable: false,
      alternatives: ["/Volumes/Kumagai-1/graphium_commons"],
      remote: "smb://kumagai@nas.local/Kumagai",
    },
    onUseAlternative: (p: string) => alert(`use ${p}`),
  },
};
