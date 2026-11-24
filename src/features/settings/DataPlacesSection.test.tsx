// @vitest-environment jsdom
// 設定 → ストレージ の「データの置き場」一覧。文言は既定の en で照合する。
// - 一覧（名前・フォルダの場所・届いているか）が出る
// - 「フォルダを登録」で追加（キャンセルなら何もしない）→ 名前の入力が出る
// - ⋯ の「名前を変える」で改名
// - ⋯ の「登録を外す」はアプリ内の確認を通してから（取り消せば外さない）
// - shared が false の置き場には「この端末だけ」の補足が出る

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { __setConfirmResponderForTest } from "../../ui/confirm-dialog";
import { DataPlacesSection } from "./DataPlacesSection";
import type { PlaceInfo } from "../linked-files";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  __setConfirmResponderForTest(null);
});

const ORG: PlaceInfo = { id: "p-org", name: "Whole bakery", root: "/Volumes/Bakery/Shared", reachable: true, shared: true };
const TEAM: PlaceInfo = { id: "p-team", name: "Sourdough team", root: "/Volumes/Bakery/Sourdough", reachable: false, shared: false };

function setup(initial: PlaceInfo[]) {
  let places = [...initial];
  const fns = {
    listPlaces: vi.fn(async () => places),
    registerPlace: vi.fn<() => Promise<PlaceInfo | null>>(async () => null),
    renamePlace: vi.fn(async (id: string, name: string) => {
      places = places.map((p) => (p.id === id ? { ...p, name } : p));
      return places.find((p) => p.id === id)!;
    }),
    persistPlaceName: vi.fn(async (_id: string, _name: string) => 1),
    removePlace: vi.fn(async (id: string) => {
      places = places.filter((p) => p.id !== id);
    }),
  };
  fns.registerPlace.mockImplementation(async () => {
    const added: PlaceInfo = { id: "p-new", name: "Front-of-house", root: "/Volumes/Bakery/Front", reachable: true, shared: true };
    places = [...places, added];
    return added;
  });
  render(
    <LocaleProvider>
      <DataPlacesSection __test={fns} />
    </LocaleProvider>,
  );
  return { fns, setPlaces: (p: PlaceInfo[]) => (places = p) };
}

const rows = () => screen.getAllByTestId("data-place-card");
const openMenu = (row: HTMLElement) => fireEvent.click(within(row).getByRole("button", { name: /^Actions for/ }));

describe("DataPlacesSection", () => {
  it("置き場が無ければ案内と「フォルダを登録」を出す", async () => {
    setup([]);
    await screen.findByText(/No linked folder yet/);
    expect(screen.getByRole("button", { name: "Register a folder" })).toBeTruthy();
  });

  it("一覧に名前・フォルダの場所・届いているかを出す", async () => {
    setup([ORG, TEAM]);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(within(rows()[0]).getByText("Whole bakery")).toBeTruthy();
    expect(within(rows()[0]).getByText("/Volumes/Bakery/Shared")).toBeTruthy();
    expect(within(rows()[0]).getByText("Reachable")).toBeTruthy();
    expect(within(rows()[1]).getByText("Can't reach it right now")).toBeTruthy();
  });

  it("shared が false の置き場にだけ「この端末だけ」の補足が出る", async () => {
    setup([ORG, TEAM]);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(within(rows()[0]).queryByText(/Used on this device only/)).toBeNull();
    expect(within(rows()[1]).getByText(/Used on this device only/)).toBeTruthy();
  });

  it("「フォルダを登録」で追加し、名前の入力が出る。キャンセルなら何もしない", async () => {
    const { fns } = setup([ORG]);
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Register a folder" }));
    const input = (await screen.findByLabelText("Folder label")) as HTMLInputElement;
    expect(input.value).toBe("Front-of-house");
    await waitFor(() => expect(rows()).toHaveLength(2));

    fns.registerPlace.mockImplementation(async () => null);
    const before = fns.listPlaces.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Register a folder" }));
    await waitFor(() => expect(fns.registerPlace).toHaveBeenCalledTimes(2));
    expect(fns.listPlaces.mock.calls.length).toBe(before);
    expect(rows()).toHaveLength(2);
  });

  it("⋯ の「名前を変える」で名前の入力に変わり、外側で確定すると改名される", async () => {
    const { fns } = setup([ORG]);
    await waitFor(() => expect(rows()).toHaveLength(1));
    openMenu(rows()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Folder label");
    fireEvent.change(input, { target: { value: "Bakery HQ" } });
    fireEvent.blur(input);
    await waitFor(() => expect(fns.renamePlace).toHaveBeenCalledWith("p-org", "Bakery HQ"));
    // その置き場のリンクした素材の名前（一覧に出る置き場の名前）も合わせる
    await waitFor(() => expect(fns.persistPlaceName).toHaveBeenCalledWith("p-org", "Bakery HQ"));
    await screen.findByText("Bakery HQ");
  });

  it("⋯ の「登録を外す」はアプリ内の確認を通してから。確認の文に、素材も元のファイルも残ると書く", async () => {
    const confirm = vi.fn((_m: string) => false);
    __setConfirmResponderForTest(confirm);
    const { fns } = setup([ORG, TEAM]);
    await waitFor(() => expect(rows()).toHaveLength(2));

    // 取り消せば外さない
    openMenu(rows()[1]);
    fireEvent.click(screen.getByRole("button", { name: "Unregister" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0]).toMatch(/Linked files stay in Graphium/);
    expect(confirm.mock.calls[0][0]).toMatch(/original files are not touched/);
    expect(fns.removePlace).not.toHaveBeenCalled();

    // 確認すれば外す
    __setConfirmResponderForTest(() => true);
    openMenu(rows()[1]);
    fireEvent.click(screen.getByRole("button", { name: "Unregister" }));
    await waitFor(() => expect(fns.removePlace).toHaveBeenCalledWith("p-team"));
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it("行を押すと詳しい場所が開き、届かないときは案内が出る", async () => {
    setup([TEAM]);
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(within(rows()[0]).getByRole("button", { name: "Show details" }));
    expect(screen.getByText(/can't be reached right now/)).toBeTruthy();
    expect(screen.getByText("Folder")).toBeTruthy();
  });
});
