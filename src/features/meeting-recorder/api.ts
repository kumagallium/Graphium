// 会議録音: Tauri invoke / listen の薄いラッパー（テストでは vi.mock で差し替える）

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  MeetingRecErrorEvent,
  MeetingRecLevelEvent,
  MeetingRecPermission,
  MeetingRecStartResult,
  MeetingRecStatus,
  MeetingRecStopResult,
  MeetingRecStoppedEvent,
} from "./types";

/** request: true のときだけ未許可なら OS の許可ダイアログを出す（同意文を読む前には出さない） */
export const getPermission = (opts: { request: boolean }) =>
  invoke<MeetingRecPermission>("meeting_rec_permission", { request: opts.request });
export const startRecording = () => invoke<MeetingRecStartResult>("meeting_rec_start");
export const stopRecording = () => invoke<MeetingRecStopResult>("meeting_rec_stop");
export const openScreenSettings = () => invoke<void>("meeting_rec_open_screen_settings");
export const getStatus = () => invoke<MeetingRecStatus>("meeting_rec_status");

/** 戻り値は購読解除関数 */
export const onLevel = (cb: (e: MeetingRecLevelEvent) => void) =>
  listen<MeetingRecLevelEvent>("meeting-rec-level", (ev) => cb(ev.payload));
export const onError = (cb: (e: MeetingRecErrorEvent) => void) =>
  listen<MeetingRecErrorEvent>("meeting-rec-error", (ev) => cb(ev.payload));
export const onStopped = (cb: (e: MeetingRecStoppedEvent) => void) =>
  listen<MeetingRecStoppedEvent>("meeting-rec-stopped", (ev) => cb(ev.payload));
