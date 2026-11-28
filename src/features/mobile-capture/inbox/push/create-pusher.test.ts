// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createPusher } from "./create-pusher";
import { GoogleDrivePusher } from "./drive-pusher";

beforeEach(() => {
  localStorage.clear();
});

describe("createPusher", () => {
  it("returns the Google Drive pusher when nothing is saved", () => {
    const pusher = createPusher();
    expect(pusher).toBeInstanceOf(GoogleDrivePusher);
    expect(pusher.kind).toBe("google-drive");
  });

  it("falls back to Google Drive for an unknown saved provider", () => {
    localStorage.setItem("graphium-push-provider", "something-else");
    expect(createPusher()).toBeInstanceOf(GoogleDrivePusher);
  });

  it("honors an explicit kind", () => {
    expect(createPusher("google-drive").kind).toBe("google-drive");
  });
});
