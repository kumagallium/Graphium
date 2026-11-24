// 外の AI（ChatGPT など）から届いた素材の受け取り待ち。設計: docs/internal/design_chatgpt_attachment_offer.md
export { useMaterialOffers, type MaterialOfferDeps } from "./use-material-offers";
export { MaterialOfferNoticeView } from "./MaterialOfferNoticeView";
export { MaterialOfferSection } from "./MaterialOfferSection";
export { materialBlockFor, appendBlockToDoc } from "./note-block";
export { OFFER_EXPIRE_DAYS } from "./offer-file";
