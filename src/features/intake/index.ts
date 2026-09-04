export { IntakeModal } from "./IntakeModal";
export type { IntakeState } from "./IntakeModal";

export { IntakeReceptacle } from "./IntakeReceptacle";
export { IntakeDropOverlay } from "./IntakeDropOverlay";

export { useIntake } from "./use-intake";
export { useGlobalFileDrop } from "./use-global-file-drop";

export { runIntake, mergeOutcome } from "./run-intake";
export type { IntakeDeps, IntakeOutcome, MarkdownImportResult, IntakeProgress } from "./run-intake";

export { classifyIntakeFiles } from "./classify";
export { collectDroppedFiles } from "./collect-dropped-files";
export { toIntakeFiles } from "./types";
export type { IntakeFile, IntakeSource } from "./types";
