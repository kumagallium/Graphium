// 声の入力: Tauri invoke / listen の薄いラッパー（テストでは vi.mock で差し替える）

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type VoiceInputLanguage = "auto" | "ja" | "en";
export type VoiceInputModelSize = "large-v3-turbo" | "small" | "base";

export interface VoiceInputResult {
  text: string;
  seconds: number;
}
export interface VoiceInputLevelEvent {
  /** RMS 0..1 */
  level: number;
  /** 録音開始からの秒数 */
  seconds: number;
}
export interface VoiceInputLimitEvent {
  seconds: number;
}
export interface VoiceInputErrorEvent {
  message: string;
}

/** 録音中なら reject "busy" */
export const startVoiceInput = () => invoke<void>("voice_input_start");
export const stopVoiceInput = (args: {
  language: VoiceInputLanguage;
  modelSize: VoiceInputModelSize;
  vocabulary?: string;
}) => invoke<VoiceInputResult>("voice_input_stop", args);
/** 止めて捨てる */
export const cancelVoiceInput = () => invoke<void>("voice_input_cancel");

/** 戻り値は購読解除関数 */
export const onVoiceLevel = (cb: (e: VoiceInputLevelEvent) => void) =>
  listen<VoiceInputLevelEvent>("voice-input-level", (ev) => cb(ev.payload));
export const onVoiceLimit = (cb: (e: VoiceInputLimitEvent) => void) =>
  listen<VoiceInputLimitEvent>("voice-input-limit", (ev) => cb(ev.payload));
export const onVoiceError = (cb: (e: VoiceInputErrorEvent) => void) =>
  listen<VoiceInputErrorEvent>("voice-input-error", (ev) => cb(ev.payload));
