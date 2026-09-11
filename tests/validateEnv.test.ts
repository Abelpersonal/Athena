import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateEnv, EnvValidationError } from "../src/shared/validateEnv.js";

const ENV_KEYS = [
  "LLM_PROVIDER",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "TTS_PROVIDER",
  "OPENAI_API_KEY",
  "TAVILY_API_KEY",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
] as const;

describe("validateEnv", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    // Silence the always-on TAVILY_API_KEY warning by default — its own describe block below
    // asserts on it directly; every other test just doesn't want it cluttering test output.
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    vi.restoreAllMocks();
  });

  it("skips every check entirely when options.skip is true, even with nothing configured", () => {
    expect(() => validateEnv({ skip: true })).not.toThrow();
  });

  describe("LLM_PROVIDER", () => {
    it("throws naming GEMINI_API_KEY when LLM_PROVIDER is unset (default: gemini) and the key is missing", () => {
      expect(() => validateEnv()).toThrow(EnvValidationError);
      expect(() => validateEnv()).toThrow(/GEMINI_API_KEY/);
    });

    it("passes when LLM_PROVIDER defaults to gemini and GEMINI_API_KEY is set", () => {
      process.env.GEMINI_API_KEY = "real-key";
      process.env.OPENAI_API_KEY = "real-key"; // satisfy the TTS_PROVIDER default too
      expect(() => validateEnv()).not.toThrow();
    });

    it("throws naming ANTHROPIC_API_KEY when LLM_PROVIDER=anthropic and the key is missing", () => {
      process.env.LLM_PROVIDER = "anthropic";
      process.env.OPENAI_API_KEY = "real-key";
      expect(() => validateEnv()).toThrow(/ANTHROPIC_API_KEY/);
    });

    it("passes when LLM_PROVIDER=anthropic and ANTHROPIC_API_KEY is set (GEMINI_API_KEY not required)", () => {
      process.env.LLM_PROVIDER = "anthropic";
      process.env.ANTHROPIC_API_KEY = "real-key";
      process.env.OPENAI_API_KEY = "real-key";
      expect(() => validateEnv()).not.toThrow();
    });

    it("throws naming OLLAMA_MODEL when LLM_PROVIDER=ollama and it's missing (no sane default)", () => {
      process.env.LLM_PROVIDER = "ollama";
      process.env.OPENAI_API_KEY = "real-key";
      expect(() => validateEnv()).toThrow(/OLLAMA_MODEL/);
    });

    it("passes when LLM_PROVIDER=ollama and OLLAMA_MODEL is set, with no OLLAMA_BASE_URL needed (it has a working default)", () => {
      process.env.LLM_PROVIDER = "ollama";
      process.env.OLLAMA_MODEL = "llama3.2";
      process.env.OPENAI_API_KEY = "real-key";
      expect(() => validateEnv()).not.toThrow();
    });

    it("is case-insensitive, matching getProvider()'s own selection logic", () => {
      process.env.LLM_PROVIDER = "ANTHROPIC";
      process.env.ANTHROPIC_API_KEY = "real-key";
      process.env.OPENAI_API_KEY = "real-key";
      expect(() => validateEnv()).not.toThrow();
    });
  });

  describe("TTS_PROVIDER", () => {
    it("throws naming OPENAI_API_KEY when TTS_PROVIDER defaults to openai and the key is missing", () => {
      process.env.GEMINI_API_KEY = "real-key";
      expect(() => validateEnv()).toThrow(/OPENAI_API_KEY/);
    });

    it("passes when TTS_PROVIDER=browser regardless of OPENAI_API_KEY", () => {
      process.env.GEMINI_API_KEY = "real-key";
      process.env.TTS_PROVIDER = "browser";
      expect(() => validateEnv()).not.toThrow();
    });
  });

  describe("TAVILY_API_KEY", () => {
    it("never throws when missing — only warns", () => {
      process.env.GEMINI_API_KEY = "real-key";
      process.env.OPENAI_API_KEY = "real-key";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(() => validateEnv()).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("TAVILY_API_KEY"));
    });

    it("does not warn when set", () => {
      process.env.GEMINI_API_KEY = "real-key";
      process.env.OPENAI_API_KEY = "real-key";
      process.env.TAVILY_API_KEY = "real-key";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      validateEnv();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("VAPID push configuration", () => {
    beforeEach(() => {
      process.env.GEMINI_API_KEY = "real-key";
      process.env.OPENAI_API_KEY = "real-key";
    });

    it("passes when all three VAPID vars are unset (push simply disabled)", () => {
      expect(() => validateEnv()).not.toThrow();
    });

    it("passes when all three VAPID vars are set", () => {
      process.env.VAPID_PUBLIC_KEY = "pub";
      process.env.VAPID_PRIVATE_KEY = "priv";
      process.env.VAPID_SUBJECT = "mailto:me@example.com";
      expect(() => validateEnv()).not.toThrow();
    });

    it("throws naming exactly the missing variable(s) when only one of three is set", () => {
      process.env.VAPID_PUBLIC_KEY = "pub";
      let message = "";
      try {
        validateEnv();
      } catch (error) {
        message = (error as Error).message;
      }
      // Only the two genuinely-unset vars are reported as missing — VAPID_PUBLIC_KEY (set) is not,
      // even though it's still named in the general "set all three" instructional text.
      expect(message).toMatch(/configured — VAPID_PRIVATE_KEY, VAPID_SUBJECT missing/);
    });

    it("throws when two of three are set", () => {
      process.env.VAPID_PUBLIC_KEY = "pub";
      process.env.VAPID_PRIVATE_KEY = "priv";
      expect(() => validateEnv()).toThrow(/VAPID_SUBJECT/);
    });
  });

  it("reports every failing check together in one error, not just the first", () => {
    process.env.LLM_PROVIDER = "anthropic"; // missing ANTHROPIC_API_KEY
    process.env.VAPID_PUBLIC_KEY = "pub"; // missing PRIVATE_KEY + SUBJECT
    let message = "";
    try {
      validateEnv();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/ANTHROPIC_API_KEY/);
    expect(message).toMatch(/OPENAI_API_KEY/); // TTS default also unmet
    expect(message).toMatch(/VAPID_PRIVATE_KEY/);
    expect(message).toMatch(/VAPID_SUBJECT/);
  });
});
