// @vitest-environment jsdom
// データ取り込みダイアログのテスト。
//
// 対象の不変条件:
// - 文書の表の行数上限（DOC_TABLE_HARD_MAX_ROWS）は、挿入形式を選べる画面で「文書の表」を
//   選んだときだけ掛ける。チャートが素材から直接読む経路（showTargetChoice={false}）は
//   内部の target が "table" になるが、表を作らないので上限は無関係
// - 行数が SYNC_PARSE_MAX_ROWS を超えるファイルは標本だけ変換し、行数は全体を数える

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { syncLocale } from "../../i18n";
import { DataImportModal, type DataImportResult } from "./DataImportModal";
import { DOC_TABLE_HARD_MAX_ROWS } from "./target";
import { PREVIEW_SAMPLE_ROWS, SYNC_PARSE_MAX_ROWS } from "./large-file";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => cleanup());

function csv(rows: number): string {
  return ["time,value", ...Array.from({ length: rows }, (_, i) => `${i},${i % 97}`)].join("\n");
}

describe("DataImportModal / 行数の上限", () => {
  it("showTargetChoice={false} なら 1,000 行を超えても確定できる", () => {
    const onConfirm = vi.fn();
    render(
      <DataImportModal
        fileName="spectrum.csv"
        text={csv(DOC_TABLE_HARD_MAX_ROWS + 500)}
        rowLimit={null}
        showTargetChoice={false}
        confirmLabel="確定する"
        onCancel={() => {}}
        onConfirm={onConfirm}
      />
    );
    const button = screen.getByRole("button", { name: "確定する" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("挿入形式を選べる画面で「文書の表」を選ぶと 1,000 行超は確定できない", () => {
    render(
      <DataImportModal
        fileName="log.csv"
        text={csv(DOC_TABLE_HARD_MAX_ROWS + 500)}
        initialTarget="table"
        rowLimit={null}
        confirmLabel="確定する"
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    );
    const button = screen.getByRole("button", { name: "確定する" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

describe("DataImportModal / 大きなファイル", () => {
  it("SYNC_PARSE_MAX_ROWS を超えると標本だけ変換し、行数は全体で返す", () => {
    let result: DataImportResult | null = null;
    const total = SYNC_PARSE_MAX_ROWS + 1_000;
    render(
      <DataImportModal
        fileName="big.csv"
        text={csv(total)}
        initialTarget="dataTable"
        rowLimit={null}
        confirmLabel="確定する"
        onCancel={() => {}}
        onConfirm={(r) => {
          result = r;
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "確定する" }));
    expect(result).not.toBeNull();
    const r = result as unknown as DataImportResult;
    expect(r.rowCount).toBe(total);
    expect(r.rowsComplete).toBe(false);
    expect(r.parsed.rows).toHaveLength(PREVIEW_SAMPLE_ROWS);
  });

  it("上限以下なら全行を変換し rowsComplete は true", () => {
    let result: DataImportResult | null = null;
    render(
      <DataImportModal
        fileName="small.csv"
        text={csv(300)}
        initialTarget="dataTable"
        rowLimit={null}
        confirmLabel="確定する"
        onCancel={() => {}}
        onConfirm={(r) => {
          result = r;
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "確定する" }));
    const r = result as unknown as DataImportResult;
    expect(r.rowCount).toBe(300);
    expect(r.rowsComplete).toBe(true);
    expect(r.parsed.rows).toHaveLength(300);
  });
});

describe("DataImportModal / 絞り込む", () => {
  beforeEach(() => syncLocale("ja"));

  /** value 列は i % 97。1,500 行のうち value ≥ 50 の行は 1,000 行に届かない */
  const bigCsv = csv(1500);

  function renderModal(
    props: Partial<React.ComponentProps<typeof DataImportModal>> = {},
    text = csv(120)
  ) {
    const onConfirm = vi.fn();
    render(
      <DataImportModal
        fileName="oven-curves.csv"
        text={text}
        initialTarget="dataTable"
        rowLimit={null}
        confirmLabel="確定する"
        onCancel={() => {}}
        onConfirm={onConfirm}
        {...props}
      />
    );
    const confirm = () => screen.getByRole("button", { name: "確定する" }) as HTMLButtonElement;
    return { onConfirm, confirm };
  }

  it("段は畳んだ状態が既定で、絞らずに確定すると結果に extract が無い", () => {
    const { onConfirm, confirm } = renderModal();
    const toggle = screen.getByRole("button", { name: /絞り込む/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(confirm());
    const r = onConfirm.mock.calls[0][0] as DataImportResult;
    expect("extract" in r).toBe(false);
    expect(r.rowCount).toBe(120);
  });

  it("段を開いただけ（条件なし・全列）でも、結果に extract が無い", () => {
    const { onConfirm, confirm } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /絞り込む/ }));
    fireEvent.click(confirm());
    const r = onConfirm.mock.calls[0][0] as DataImportResult;
    expect("extract" in r).toBe(false);
  });

  it("条件を足すと extract が入り、行数が絞った後の数になる", () => {
    const { onConfirm, confirm } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /絞り込む/ }));
    fireEvent.click(screen.getByRole("button", { name: "条件を足す" }));
    fireEvent.change(screen.getByLabelText("条件"), { target: { value: "ge" } });
    fireEvent.change(screen.getByLabelText("値"), { target: { value: "90" } });
    fireEvent.click(confirm());
    const r = onConfirm.mock.calls[0][0] as DataImportResult;
    // 足した条件の列は先頭の time（0〜119）。90 以上は 30 行
    const expected = 30;
    expect(r.extract).toBeDefined();
    expect(r.extract!.result.rows).toHaveLength(expected);
    expect(r.extract!.sourceRows).toBe(120);
    expect(r.extract!.spec.columns).toEqual([]);
    expect(r.extract!.spec.conditions).toEqual([{ column: "time", op: "ge", value: "90" }]);
    // 絞り込む前の値はそのまま
    expect(r.rowCount).toBe(120);
  });

  it("「なし」で 0 列になり、確定できず理由が出る（全列扱いにしない）", () => {
    const { onConfirm, confirm } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /絞り込む/ }));
    fireEvent.click(screen.getByRole("button", { name: "なし" }));
    expect(confirm().disabled).toBe(true);
    expect(screen.getByText("列を 1 つ以上選んでください")).toBeTruthy();
    fireEvent.click(confirm());
    expect(onConfirm).not.toHaveBeenCalled();
    // 「すべて」で戻る
    fireEvent.click(screen.getByRole("button", { name: "すべて" }));
    expect(confirm().disabled).toBe(false);
  });

  it("結果が 0 行のときは確定できず理由が出る", () => {
    const { confirm } = renderModal({
      initialExtract: { columns: [], conditions: [{ column: "value", op: "ge", value: "1000" }] },
    });
    expect(confirm().disabled).toBe(true);
    expect(screen.getByText("条件に合う行がありません")).toBeTruthy();
  });

  it("1,000 行の上限は絞った後の行数で判定する", () => {
    // 絞る前は 1,500 行で文書の表にできない
    const before = renderModal({ initialTarget: "table" }, bigCsv);
    expect(before.confirm().disabled).toBe(true);
    cleanup();
    // value ≥ 50 に絞ると 1,000 行以下になり、確定できる
    const after = renderModal(
      {
        initialTarget: "table",
        initialExtract: { columns: [], conditions: [{ column: "value", op: "ge", value: "50" }] },
      },
      bigCsv
    );
    expect(after.confirm().disabled).toBe(false);
    fireEvent.click(after.confirm());
    const r = after.onConfirm.mock.calls[0][0] as DataImportResult;
    expect(r.extract!.result.rows.length).toBeLessThanOrEqual(DOC_TABLE_HARD_MAX_ROWS);
    expect(r.extract!.sourceRows).toBe(1500);
  });

  it("initialExtract で段が開き、条件と列が復元される", () => {
    const { onConfirm, confirm } = renderModal({
      initialExtract: {
        columns: ["time"],
        conditions: [{ column: "value", op: "lt", value: "10" }],
      },
    });
    expect(screen.getByRole("button", { name: /絞り込む/ }).getAttribute("aria-expanded")).toBe(
      "true"
    );
    expect((screen.getByLabelText("値") as HTMLInputElement).value).toBe("10");
    const checks = screen.getAllByRole("checkbox") as HTMLInputElement[];
    const time = checks.find((c) => c.parentElement?.textContent?.startsWith("time"))!;
    const value = checks.find((c) => c.parentElement?.textContent?.startsWith("value"))!;
    expect(time.checked).toBe(true);
    expect(value.checked).toBe(false);
    fireEvent.click(confirm());
    const r = onConfirm.mock.calls[0][0] as DataImportResult;
    expect(r.extract!.result.headers).toEqual(["time"]);
    expect(r.extract!.spec.columns).toEqual(["time"]);
  });

  it("畳んでも条件が残っていれば、条件の文と行数が出て絞り込みは効いたまま", () => {
    const { onConfirm, confirm } = renderModal({
      initialExtract: { columns: [], conditions: [{ column: "value", op: "lt", value: "10" }] },
    });
    fireEvent.click(screen.getByRole("button", { name: /絞り込む/ }));
    expect(screen.getByText(/value < 10（120 行のうち \d+ 行）/)).toBeTruthy();
    fireEvent.click(confirm());
    expect((onConfirm.mock.calls[0][0] as DataImportResult).extract).toBeDefined();
  });

  it("大きなファイルは、段を開くまで全行を読まず、開くと読み終わるまで確定できない", async () => {
    const total = SYNC_PARSE_MAX_ROWS + 1_000;
    const { onConfirm, confirm } = renderModal({}, csv(total));
    // 閉じたままなら今までどおり標本だけ・確定できる
    expect(confirm().disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /絞り込む/ }));
    expect(screen.getByText("全体を読んでいます…")).toBeTruthy();
    expect(confirm().disabled).toBe(true);
    await waitFor(() => expect(screen.queryByText("全体を読んでいます…")).toBeNull(), {
      timeout: 15_000,
    });
    expect(confirm().disabled).toBe(false);
    // 全行から絞る: value = i % 97 が 96 の行
    fireEvent.click(screen.getByRole("button", { name: "条件を足す" }));
    fireEvent.change(screen.getByLabelText("値"), { target: { value: "96" } });
    fireEvent.change(screen.getByLabelText("列"), { target: { value: "value" } });
    fireEvent.click(confirm());
    const r = onConfirm.mock.calls[0][0] as DataImportResult;
    const expected = Array.from({ length: total }, (_, i) => i % 97).filter((v) => v === 96).length;
    expect(r.extract!.result.rows).toHaveLength(expected);
    expect(r.extract!.sourceRows).toBe(total);
  }, 30_000);
});
