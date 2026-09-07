import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetText = vi.fn();
const mockDestroy = vi.fn().mockResolvedValue(undefined);

vi.mock("pdf-parse", () => ({
  PDFParse: vi.fn().mockImplementation(function MockPDFParse() {
    return {
      getText: mockGetText,
      destroy: mockDestroy,
    };
  }),
}));

const { parsePdf } = await import("../src/extraction/fetchAndCleanPdf.js");
const { PDFParse } = await import("pdf-parse");

describe("parsePdf", () => {
  beforeEach(() => {
    mockGetText.mockReset();
    mockDestroy.mockClear();
    vi.mocked(PDFParse).mockClear();
  });

  it("maps pdf-parse's real TextResult shape (pages[].num/text, text, total) into ParsedPdfResult", async () => {
    mockGetText.mockResolvedValueOnce({
      pages: [
        { num: 1, text: "Page one real text." },
        { num: 2, text: "Page two real text." },
      ],
      text: "Page one real text.\nPage two real text.",
      total: 2,
    });

    const result = await parsePdf(new ArrayBuffer(8));

    expect(result).toEqual({
      text: "Page one real text.\nPage two real text.",
      chunks: [
        { text: "Page one real text.", pageNumber: 1 },
        { text: "Page two real text.", pageNumber: 2 },
      ],
      totalPages: 2,
    });
  });

  it("passes the raw data through to the PDFParse constructor unchanged", async () => {
    const data = new ArrayBuffer(4);
    mockGetText.mockResolvedValueOnce({ pages: [], text: "", total: 0 });

    await parsePdf(data);

    expect(vi.mocked(PDFParse)).toHaveBeenCalledExactlyOnceWith({ data });
  });

  it("always destroys the parser, even when getText() throws (a corrupt/malformed PDF)", async () => {
    mockGetText.mockRejectedValueOnce(new Error("corrupt PDF structure"));

    await expect(parsePdf(new ArrayBuffer(8))).rejects.toThrow("corrupt PDF structure");
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the parser after a successful parse too", async () => {
    mockGetText.mockResolvedValueOnce({ pages: [], text: "", total: 0 });

    await parsePdf(new ArrayBuffer(8));

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
