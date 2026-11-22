// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (e: never) => void;
const handlers: Record<string, Handler> = {};
const api = vi.hoisted(() => ({
  startVoiceInput: vi.fn(),
  stopVoiceInput: vi.fn(),
  cancelVoiceInput: vi.fn(),
}));
vi.mock("./api", () => ({
  ...api,
  onVoiceLevel: (cb: Handler) => ((handlers.level = cb), Promise.resolve(() => {})),
  onVoiceLimit: (cb: Handler) => ((handlers.limit = cb), Promise.resolve(() => {})),
  onVoiceError: (cb: Handler) => ((handlers.error = cb), Promise.resolve(() => {})),
}));
vi.mock("../../lib/platform", () => ({ isTauri: () => true }));
vi.mock("../settings/store", () => ({
  loadSettings: () => ({ meetingLanguage: "ja", meetingModelSize: "small", meetingVocabulary: "" }),
}));

const { useVoiceInput } = await import("./use-voice-input");

const emit = (name: string, payload: unknown) => act(async () => (handlers[name] as (e: unknown) => void)(payload));

async function setup() {
  const onText = vi.fn();
  const hook = renderHook(() => useVoiceInput({ onText }));
  await act(async () => {}); // listen の登録を待つ
  return { onText, ...hook };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.startVoiceInput.mockResolvedValue(undefined);
  api.cancelVoiceInput.mockResolvedValue(undefined);
  api.stopVoiceInput.mockResolvedValue({ text: "えっと、会議の要約。", seconds: 3 });
});

describe("useVoiceInput", () => {
  it("start → 話して静かになると自動で stop → onText", async () => {
    const { result, onText } = await setup();
    await act(async () => result.current.start());
    expect(result.current.status).toBe("recording");
    await emit("level", { level: 0.1, seconds: 1 });
    await emit("level", { level: 0, seconds: 2 });
    expect(api.stopVoiceInput).not.toHaveBeenCalled();
    await emit("level", { level: 0, seconds: 2.6 });
    expect(api.stopVoiceInput).toHaveBeenCalledWith({ language: "ja", modelSize: "small", vocabulary: undefined });
    expect(onText).toHaveBeenCalledWith("会議の要約");
    expect(result.current.status).toBe("idle");
  });

  it("model-missing", async () => {
    api.stopVoiceInput.mockRejectedValue("model-missing");
    const { result, onText } = await setup();
    await act(async () => result.current.start());
    await act(async () => result.current.stop());
    expect(result.current.error).toBe("model-missing");
    expect(onText).not.toHaveBeenCalled();
  });

  it("声が無ければ no-speech", async () => {
    api.stopVoiceInput.mockResolvedValue({ text: "", seconds: 1 });
    const { result, onText } = await setup();
    await act(async () => result.current.start());
    await act(async () => result.current.stop());
    expect(result.current.error).toBe("no-speech");
    expect(onText).not.toHaveBeenCalled();
  });

  it("busy は無視する", async () => {
    api.startVoiceInput.mockRejectedValue("busy");
    const { result } = await setup();
    await act(async () => result.current.start());
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("Esc で cancel し、伝播を止める", async () => {
    const { result } = await setup();
    await act(async () => result.current.start());
    const down = vi.fn();
    document.addEventListener("keydown", down);
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    document.removeEventListener("keydown", down);
    expect(api.cancelVoiceInput).toHaveBeenCalled();
    expect(down).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("アンマウントで録音中なら cancel", async () => {
    const { result, unmount } = await setup();
    await act(async () => result.current.start());
    unmount();
    expect(api.cancelVoiceInput).toHaveBeenCalled();
  });

  it("voice-input-error で cancel して error", async () => {
    const { result } = await setup();
    await act(async () => result.current.start());
    await emit("error", { message: "no-input-device" });
    expect(api.cancelVoiceInput).toHaveBeenCalled();
    expect(result.current.error).toBe("no-device");
  });
});
