import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  createdFromCoreXml,
  createdFromOoxmlBytes,
  createdFromPdfBytes,
  embeddedDateKind,
  isoLikeToDay,
  pdfDateToDay,
  pdfInfoCreatedFromBytes,
} from "./embedded-created-date";

const NOW = new Date("2026-11-24T12:00:00Z");

/** 時差つきの瞬間を、テストを走らせている端末の暦日に（TZ に依らない期待値） */
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const coreXml = (created: string, modified = "2026-11-20T00:00:00Z") =>
  `<?xml version="1.0"?><cp:coreProperties xmlns:dcterms="http://purl.org/dc/terms/">` +
  `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` +
  `<dcterms:modified xsi:type="dcterms:W3CDTF">${modified}</dcterms:modified></cp:coreProperties>`;

describe("embeddedDateKind", () => {
  it("Office と PDF だけを対象にする", () => {
    expect(embeddedDateKind("a.DOCX")).toBe("ooxml");
    expect(embeddedDateKind("a.pptx")).toBe("ooxml");
    expect(embeddedDateKind("a.xlsx")).toBe("ooxml");
    expect(embeddedDateKind("a.pdf")).toBe("pdf");
    expect(embeddedDateKind("noext", "application/pdf")).toBe("pdf");
    expect(embeddedDateKind("a.png", "image/png")).toBeNull();
    expect(embeddedDateKind("a.doc")).toBeNull();
  });
});

describe("createdFromCoreXml", () => {
  it("最終保存日ではなく作成日を読む", () => {
    expect(createdFromCoreXml(coreXml("2016-05-03T12:02:03Z"), NOW)).toBe(localDay("2016-05-03T12:02:03Z"));
  });
  it("作成日が無ければ null", () => {
    expect(createdFromCoreXml("<cp:coreProperties/>", NOW)).toBeNull();
  });
  it("未来の日付と 1980 年より前は捨てる", () => {
    expect(createdFromCoreXml(coreXml("2030-01-01T00:00:00Z"), NOW)).toBeNull();
    expect(createdFromCoreXml(coreXml("1601-01-01T00:00:00Z"), NOW)).toBeNull();
  });
});

describe("createdFromOoxmlBytes", () => {
  it("docx の zip から読む", () => {
    const zip = zipSync({
      "docProps/core.xml": strToU8(coreXml("2012-03-15T09:00:00Z")),
      "word/document.xml": strToU8("<w:document/>"),
    });
    expect(createdFromOoxmlBytes(zip, NOW)).toBe(localDay("2012-03-15T09:00:00Z"));
  });
  it("core.xml が無い・zip でなければ null", () => {
    expect(createdFromOoxmlBytes(zipSync({ "a.txt": strToU8("x") }), NOW)).toBeNull();
    expect(createdFromOoxmlBytes(strToU8("not a zip"), NOW)).toBeNull();
  });
});

describe("isoLikeToDay", () => {
  it("時差の無い日時・日付だけは、書かれた暦日のまま（端末の時差で動かさない）", () => {
    expect(isoLikeToDay("2016-05-03", NOW)).toBe("2016-05-03");
    expect(isoLikeToDay("2016-05-03T23:30:00", NOW)).toBe("2016-05-03");
  });
  it("時差つきは端末の暦日に直す", () => {
    expect(isoLikeToDay("2016-05-03T23:30:00+09:00", NOW)).toBe(localDay("2016-05-03T23:30:00+09:00"));
  });
  it("実在しない日は null", () => {
    expect(isoLikeToDay("2016-02-30", NOW)).toBeNull();
    expect(isoLikeToDay("2016-13-01", NOW)).toBeNull();
    expect(isoLikeToDay("garbage", NOW)).toBeNull();
  });
});

describe("pdfDateToDay", () => {
  it("時差の無い PDF の日付は書かれた暦日のまま。年だけ・年月だけも読む", () => {
    expect(pdfDateToDay("D:20160503000000", NOW)).toBe("2016-05-03");
    expect(pdfDateToDay("D:20160503", NOW)).toBe("2016-05-03");
    expect(pdfDateToDay("D:2016", NOW)).toBe("2016-01-01");
  });
  it("時差つきは端末の暦日に直す", () => {
    expect(pdfDateToDay("D:20160503230000-07'00'", NOW)).toBe(localDay("2016-05-03T23:00:00-07:00"));
    expect(pdfDateToDay("D:20150102120000Z", NOW)).toBe(localDay("2015-01-02T12:00:00Z"));
  });
  it("月・日が 00 や 13 なら繰り下げずに null", () => {
    expect(pdfDateToDay("D:20160100", NOW)).toBeNull();
    expect(pdfDateToDay("D:20161301", NOW)).toBeNull();
    expect(pdfDateToDay("D:20160231", NOW)).toBeNull();
  });
  it("1980 年より前・未来・文字列でないものは null", () => {
    expect(pdfDateToDay("D:19700101", NOW)).toBeNull();
    expect(pdfDateToDay("D:20300101", NOW)).toBeNull();
    expect(pdfDateToDay(undefined, NOW)).toBeNull();
  });
});

describe("createdFromPdfBytes", () => {
  it("情報辞書の CreationDate を読み、ModDate は使わない", () => {
    const pdf = strToU8("%PDF-1.4\n1 0 obj << /ModDate (D:20261120000000Z) /CreationDate (D:20110704120000) >> endobj");
    expect(createdFromPdfBytes(pdf, NOW)).toBe("2011-07-04");
  });
  it("情報辞書が無ければ XMP の CreateDate", () => {
    const pdf = strToU8("%PDF-1.7\n<x:xmpmeta><xmp:CreateDate>2019-02-01T10:00:00</xmp:CreateDate></x:xmpmeta>");
    expect(createdFromPdfBytes(pdf, NOW)).toBe("2019-02-01");
  });
  it("どちらも無ければ null", () => {
    expect(createdFromPdfBytes(strToU8("%PDF-1.4\n%%EOF"), NOW)).toBeNull();
  });
  it("添付ファイルの作成日より、後ろにある情報辞書の作成日を採る", () => {
    const pdf = strToU8(
      "%PDF-1.4\n5 0 obj << /Type /EmbeddedFile /Params << /CreationDate (D:19990101) >> >> endobj\n" +
        "9 0 obj << /CreationDate (D:20080808) >> endobj\ntrailer << /Info 9 0 R >>",
    );
    expect(pdfInfoCreatedFromBytes(pdf, NOW)).toBe("2008-08-08");
  });
  it("大きい PDF は両端だけを見る", () => {
    const big = new Uint8Array(5 * 1024 * 1024).fill(32);
    big.set(strToU8("/CreationDate (D:20070707)"), big.length - 100);
    expect(pdfInfoCreatedFromBytes(big, NOW)).toBe("2007-07-07");
  });
});

