import { describe, it, expect } from "vitest";
import {
  hasLabelAttributes,
  DEFAULT_STEP_ATTRIBUTES,
  getExecutorLabel,
  getStatusLabel,
  getStatusConfig,
  STATUS_COLORS,
  EXECUTOR_LABELS,
  STATUS_CONFIG,
  type ExecutorType,
  type StepStatus,
} from "./label-attributes";

// 全実行者タイプ
const ALL_EXECUTORS: ExecutorType[] = ["human", "machine", "ai"];

// 全ステータス
const ALL_STATUSES: StepStatus[] = ["planned", "in-progress", "done", "skipped"];

describe("hasLabelAttributes", () => {
  it('"[手順]" に対して true を返す', () => {
    expect(hasLabelAttributes("[手順]")).toBe(true);
  });

  it("その他のラベルに対して false を返す", () => {
    expect(hasLabelAttributes("[結果]")).toBe(false);
    expect(hasLabelAttributes("[属性]")).toBe(false);
    expect(hasLabelAttributes("[使用したもの]")).toBe(false);
    expect(hasLabelAttributes("任意のテキスト")).toBe(false);
    expect(hasLabelAttributes("")).toBe(false);
  });
});

describe("DEFAULT_STEP_ATTRIBUTES", () => {
  it("正しいデフォルト値を持つ", () => {
    expect(DEFAULT_STEP_ATTRIBUTES.checked).toBe(false);
    expect(DEFAULT_STEP_ATTRIBUTES.executor).toBe("human");
    expect(DEFAULT_STEP_ATTRIBUTES.status).toBe("planned");
  });

  it("必要なプロパティをすべて持つ", () => {
    expect(DEFAULT_STEP_ATTRIBUTES).toHaveProperty("checked");
    expect(DEFAULT_STEP_ATTRIBUTES).toHaveProperty("executor");
    expect(DEFAULT_STEP_ATTRIBUTES).toHaveProperty("status");
  });
});

describe("getExecutorLabel", () => {
  it('"human", "machine", "ai" に対して空でない文字列を返す', () => {
    for (const executor of ALL_EXECUTORS) {
      const label = getExecutorLabel(executor);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("getStatusLabel", () => {
  it("全ステータスに対して空でない文字列を返す", () => {
    for (const status of ALL_STATUSES) {
      const label = getStatusLabel(status);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("getStatusConfig", () => {
  it("label と color を持つオブジェクトを返す", () => {
    for (const status of ALL_STATUSES) {
      const config = getStatusConfig(status);
      expect(config).toHaveProperty("label");
      expect(config).toHaveProperty("color");
      expect(typeof config.label).toBe("string");
      expect(config.label.length).toBeGreaterThan(0);
      expect(typeof config.color).toBe("string");
      expect(config.color.length).toBeGreaterThan(0);
    }
  });

  it("STATUS_COLORS と一致する色を返す", () => {
    for (const status of ALL_STATUSES) {
      const config = getStatusConfig(status);
      expect(config.color).toBe(STATUS_COLORS[status]);
    }
  });

  it("getStatusLabel と一致するラベルを返す", () => {
    for (const status of ALL_STATUSES) {
      const config = getStatusConfig(status);
      expect(config.label).toBe(getStatusLabel(status));
    }
  });
});

describe("STATUS_COLORS", () => {
  it("全 4 ステータスのエントリを持つ", () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_COLORS[status]).toBeDefined();
      expect(typeof STATUS_COLORS[status]).toBe("string");
    }
    expect(Object.keys(STATUS_COLORS)).toHaveLength(4);
  });
});

describe("EXECUTOR_LABELS (Proxy)", () => {
  it("アクセサが正しく動作する", () => {
    for (const executor of ALL_EXECUTORS) {
      const label = EXECUTOR_LABELS[executor];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
      expect(label).toBe(getExecutorLabel(executor));
    }
  });
});

describe("STATUS_CONFIG (Proxy)", () => {
  it("アクセサが label と color を返す", () => {
    for (const status of ALL_STATUSES) {
      const config = STATUS_CONFIG[status];
      expect(config).toHaveProperty("label");
      expect(config).toHaveProperty("color");
      expect(typeof config.label).toBe("string");
      expect(config.label.length).toBeGreaterThan(0);
      expect(typeof config.color).toBe("string");
      // getStatusConfig と同じ結果であることを確認
      const expected = getStatusConfig(status);
      expect(config.label).toBe(expected.label);
      expect(config.color).toBe(expected.color);
    }
  });
});
