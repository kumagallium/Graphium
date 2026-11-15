// 宛先検査（safe-fetch）の回帰テスト: IPv6 に埋め込まれた IPv4 も IPv4 と同じ判定に掛かること

import { describe, expect, it } from "vitest";

import { isBlockedAddress, isBlockedUrl } from "./safe-fetch";

describe("IPv6 に埋め込まれた IPv4", () => {
  it("メタデータ宛（169.254.169.254）は strict / metadata-only どちらでも止まる", () => {
    for (const u of [
      "http://[::ffff:169.254.169.254]/",
      "http://[::ffff:a9fe:a9fe]/",
      "http://[64:ff9b::a9fe:a9fe]/",
      "http://[2002:a9fe:a9fe::]/",
      "http://[::ffff:0:a9fe:a9fe]/",
    ]) {
      expect(isBlockedUrl(u, "strict"), u).toBe(true);
      expect(isBlockedUrl(u, "metadata-only"), u).toBe(true);
    }
  });
  it("LAN・ループバック宛は strict だけ止まり、metadata-only は通す", () => {
    for (const a of ["::ffff:10.0.0.1", "64:ff9b::7f00:1", "2002:c0a8:1::", "::ffff:127.0.0.1"]) {
      expect(isBlockedAddress(a, "strict"), a).toBe(true);
      expect(isBlockedAddress(a, "metadata-only"), a).toBe(false);
    }
  });
  it("公開アドレスを包む形は通す", () => {
    for (const a of ["64:ff9b::5db8:d822", "2002:5db8:d822::", "::ffff:93.184.216.34", "2001:db8::1"]) {
      expect(isBlockedAddress(a, "strict"), a).toBe(false);
    }
  });
});
