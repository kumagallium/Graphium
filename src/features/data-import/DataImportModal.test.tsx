// @vitest-environment jsdom
// データ取り込みダイアログのテスト。
//
// 対象の不変条件:
// - 文書の表の行数上限（DOC_TABLE_HARD_MAX_ROWS）は、挿入形式を選べる画面で「文書の表」を
//   選んだときだけ掛ける。チャートが素材から直接読む経路（showTargetChoice={false}）は
//   内部の target が "table" になるが、表を作らないので上限は無関係
// - 行数が SYNC_PARSE_MAX_ROWS を超えるファイルは標本だけ変換し、行数は全体を数える

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
