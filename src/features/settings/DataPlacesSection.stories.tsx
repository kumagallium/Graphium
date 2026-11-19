// DataPlacesSection — 設定 → ストレージ の「データの置き場」一覧（デスクトップ版）。
// 行: 状態の印・名前・フォルダの場所・⋯。行を押すと場所と、届かないときの案内が開く。
// 置き場の操作は Tauri に依存するので、ここでは差し替えている（登録・改名・外すは見かけだけ動く）。
// 「外す」の確認はアプリ内の確認（ConfirmHost）。ストーリーでは ConfirmHost を置いてある。

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DataPlacesSection, type DataPlacesSectionProps } from "./DataPlacesSection";
import type { PlaceInfo } from "../linked-files";
import { ConfirmHost } from "../../ui/confirm-dialog";

const place = (over: Partial<PlaceInfo> & Pick<PlaceInfo, "id" | "name" | "root">): PlaceInfo => ({
  reachable: true,
  shared: true,
  ...over,
});

const ORG = place({ id: "org", name: "Whole bakery", root: "/Volumes/Bakery/Shared" });
const TEAM = place({ id: "team", name: "Sourdough team", root: "/Volumes/Bakery/Sourdough" });
const OFFLINE = place({ id: "off", name: "Sourdough team", root: "/Volumes/Bakery/Sourdough", reachable: false });
const NO_MARKER = place({ id: "solo", name: "Front-of-house", root: "/Users/me/Documents/Front", shared: false });

/** 見かけだけ動く置き場の store（本番の Rust の代わり） */
function Fake({ initial }: { initial: PlaceInfo[] }) {
  const [fns] = useState<NonNullable<DataPlacesSectionProps["__test"]>>(() => {
    let places = [...initial];
    return {
      listPlaces: async () => places,
      registerPlace: async () => {
        const added = place({ id: `new-${places.length}`, name: "New folder", root: "/Volumes/Bakery/New" });
        places = [...places, added];
        return added;
      },
      renamePlace: async (id, name) => {
        places = places.map((p) => (p.id === id ? { ...p, name } : p));
        return places.find((p) => p.id === id)!;
      },
      removePlace: async (id) => {
        places = places.filter((p) => p.id !== id);
      },
    };
  });
  return (
    <div className="max-w-2xl p-4">
      <DataPlacesSection __test={fns} />
      <ConfirmHost />
    </div>
  );
}

const meta: Meta<typeof Fake> = {
  title: "Molecules/DataPlacesSection",
  component: Fake,
};
export default meta;

type Story = StoryObj<typeof Fake>;

/** まだ 1 件も無い（案内と「フォルダを登録」） */
export const Empty: Story = { args: { initial: [] } };

/** 組織全体と部署の 2 件 */
export const Multiple: Story = { args: { initial: [ORG, TEAM] } };

/** 2 件目が届かない（NAS のマウント外れ）。行の印が変わり、開くと案内が出る */
export const OneUnreachable: Story = { args: { initial: [ORG, OFFLINE] } };

/** 目印のファイルを置けなかった置き場。「この端末だけで使えます」の補足が出る */
export const NoMarker: Story = { args: { initial: [ORG, NO_MARKER] } };
