// 韓国語翻訳辞書
//
// 作成途中。無いキーは en にフォールバックする（translate() 参照）。
// ロケール ko は公開前なので既定では選べない（index.tsx の isLocaleEnabled()）。
// 公開の条件は en とのキー完全一致・プレースホルダ一致（index.test.ts）。

export const ko: Record<string, string> = {
  // ── 共通 ──
  "common.save": "저장",
  "common.saving": "저장 중...",
  "common.unsaved": "저장되지 않음",
  "common.saved": "저장됨",
  "common.menu": "메뉴",
  "common.close": "닫기",
  "common.delete": "삭제",
  "common.add": "추가",
  "common.change": "변경",
  "common.cancel": "취소",
  "common.settings": "설정",
  "common.loading": "불러오는 중...",
  "common.table": "[표]",
  "common.color": "색상",
  "common.empty": "(비어 있음)",
  "common.back": "← 뒤로",
  "common.search": "검색...",
  "common.clickToNavigate": "클릭하여 이동",
  "common.openMenu": "메뉴 열기",
  "common.create": "만들기",

  // ── 設定 ──
  "settings.language": "언어",
};
