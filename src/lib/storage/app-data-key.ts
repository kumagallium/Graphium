// appData の一覧・削除 API に渡すキー／prefix の検証
// 3 プロバイダ・サーバールート・Rust（lib.rs の validate_app_data_key）で同じ規則を使う。
// 既存の `:` 入りキー（snapshot:<id> など）は新 API の対象外。

const APP_DATA_KEY_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

/** キー・prefix が規則どおりか（空文字は不可） */
export function isValidAppDataKey(value: unknown): value is string {
  return typeof value === "string" && APP_DATA_KEY_PATTERN.test(value);
}

/** 規則に合わなければ例外。合えばそのまま返す */
export function assertValidAppDataKey(value: unknown, label = "key"): string {
  if (!isValidAppDataKey(value)) {
    throw new Error(`Invalid appData ${label}`);
  }
  return value;
}
