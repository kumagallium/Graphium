// アプリ内ヘルプ（同梱マニュアルの検索）
export {
  EXCLUDED_MANUAL_PAGES,
  parseManualPage,
  loadManualSections,
  type ManualLocale,
  type ManualSection,
} from "./manual-corpus";
export { createManualSearcher, buildManualContext, retrieveManualContext, stripManualMarkers, toManualQuery } from "./manual-search";
export { MANUAL_BASE_URL, manualHomeUrl } from "./manual-url";
