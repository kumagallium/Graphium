export * from "./types";
export * from "./save";
export * from "./load";
export { TemplatePickerModal } from "./TemplatePickerModal";
export { getTemplateSlashMenuItem, setTemplatePickerCallback } from "./slash-menu-item";
export { useTemplatePicker } from "./use-template-picker";
export {
  insertTemplateDef,
  insertPageTemplate,
  loadSharedTemplate,
  type TemplateTargetStores,
} from "./insert";
export { getAllTemplates, registerUserTemplate } from "./templates";
export {
  pageTemplateToBuildResult,
  buildDocumentFromTemplate,
  remapTemplateBlocks,
  type TemplateFromRef,
  type RemappedTemplateBlocks,
} from "./from-page-template";
export type { TemplateDef, TemplateSource, TemplateBuildResult } from "./templates";
export {
  isUserTemplateSupported,
  getUserTemplateProvider,
  getUserTemplate,
  listUserTemplates,
  saveUserTemplate,
  renameUserTemplate,
  updateUserTemplate,
  updateUserTemplateAttributes,
  revertUserTemplate,
  deleteUserTemplate,
  refreshUserTemplates,
  useUserTemplates,
  type UserTemplateRecord,
  type UserTemplateProvider,
} from "./user-template-store";
export { SaveTemplateDialog } from "./SaveTemplateDialog";
export { TemplateEditBanner } from "./TemplateEditBanner";
export {
  templateEditDocKey,
  userTemplateToEditDocument,
  userTemplateAttributes,
  startTemplateEditing,
  setUserTemplateEditHandler,
  getUserTemplateEditHandler,
  type TemplateEditing,
} from "./template-edit";
export {
  createNoteFromOfficialTemplate,
  createNoteFromUserTemplate,
  type NewNoteFromTemplateDeps,
} from "./new-note-from-template";
