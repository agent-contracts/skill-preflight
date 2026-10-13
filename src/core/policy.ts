import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Finding, Severity, SuppressedFinding } from "./types.js";

const SEVERITIES: Severity[] = ["info", "low", "medium", "high", "critical"];
const CONFIG_KEYS = new Set(["exclude", "ignoreRules", "failBelow", "failOn", "maxTokens"]);

export interface SkillPreflightConfig {
  exclude: string[];
  ignoreRules: string[];
  failBelow?: number;
  failOn?: Severity;
  maxTokens?: number;
}

export async function loadConfig(filePath?: string): Promise<SkillPreflightConfig> {
  if (!filePath) {
    return emptyConfig();
  }

  const resolvedPath = path.resolve(filePath);
  let parsed: unknown;

  try {
    parsed = JSON.parse((await readFile(resolvedPath, "utf8")).replace(/^\uFEFF/, "")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read SkillPreflight config ${resolvedPath}: ${message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Invalid SkillPreflight config ${resolvedPath}: expected a JSON object.`);
  }

  const unknownKeys = Object.keys(parsed).filter((key) => !CONFIG_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`Invalid SkillPreflight config ${resolvedPath}: unknown keys ${unknownKeys.join(", ")}.`);
  }

  for (const key of ["failBelow", "maxTokens"]) {
    if (parsed[key] !== undefined && typeof parsed[key] !== "number") {
      throw new Error(`Invalid SkillPreflight config ${resolvedPath}: ${key} must be a number.`);
    }
  }

  return {
    exclude: parseStringArray(parsed.exclude, "exclude", resolvedPath),
    ignoreRules: parseStringArray(parsed.ignoreRules, "ignoreRules", resolvedPath),
    failBelow: parsed.failBelow === undefined ? undefined : parseScoreThreshold(parsed.failBelow, "failBelow"),
    failOn: parsed.failOn === undefined ? undefined : parseSeverity(String(parsed.failOn), "failOn"),
    maxTokens: parsed.maxTokens === undefined ? undefined : parsePositiveInteger(parsed.maxTokens, "maxTokens")
  };
}

export function parseScoreThreshold(value: unknown, label: string): number {
  const parsed = numericValue(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`Invalid ${label} value: ${String(value)}. Use a number from 0 to 100.`);
  }

  return parsed;
}

export function parsePositiveInteger(value: unknown, label: string): number {
  const parsed = numericValue(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${label} value: ${String(value)}. Use a positive integer.`);
  }
  return parsed;
}

function numericValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

export function parseSeverity(value: string, label: string): Severity {
  const normalized = value.trim().toLowerCase() as Severity;
  if (!SEVERITIES.includes(normalized)) {
    throw new Error(`Invalid ${label} value: ${value}. Use info, low, medium, high, or critical.`);
  }

  return normalized;
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function isPathExcluded(relativePath: string, patterns: string[], isDirectory = false): boolean {
  const candidate = normalizeGlobValue(relativePath);
  const values = isDirectory ? [candidate, `${candidate}/`] : [candidate];

  return patterns.some((pattern) => {
    const regex = globToRegExp(pattern);
    return values.some((value) => regex.test(value));
  });
}

export function suppressFindings(
  findings: Finding[],
  ignoreRules: string[]
): { active: Finding[]; suppressed: SuppressedFinding[] } {
  const active: Finding[] = [];
  const suppressed: SuppressedFinding[] = [];

  for (const finding of findings) {
    const matchingPattern = ignoreRules.find((pattern) => globToRegExp(pattern, false).test(finding.id));
    if (matchingPattern) {
      suppressed.push({
        finding,
        reason: `Ignored by rule pattern "${matchingPattern}"`
      });
    } else {
      active.push(finding);
    }
  }

  return { active, suppressed };
}

function emptyConfig(): SkillPreflightConfig {
  return {
    exclude: [],
    ignoreRules: []
  };
}

function parseStringArray(value: unknown, key: string, filePath: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`Invalid SkillPreflight config ${filePath}: ${key} must be an array of non-empty strings.`);
  }

  return uniqueStrings(value as string[]);
}

function globToRegExp(pattern: string, pathMode = true): RegExp {
  let normalized = pathMode ? normalizeGlobValue(pattern) : pattern.trim();
  if (!normalized) {
    throw new Error("Glob patterns must not be empty.");
  }

  if (pathMode && normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }

  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (character === "*") {
      const isDouble = normalized[index + 1] === "*";
      if (isDouble) {
        const followedBySlash = normalized[index + 2] === "/";
        source += followedBySlash ? "(?:.*/)?" : ".*";
        index += followedBySlash ? 2 : 1;
      } else {
        source += pathMode ? "[^/]*" : ".*";
      }
      continue;
    }

    if (character === "?") {
      source += pathMode ? "[^/]" : ".";
      continue;
    }

    source += escapeRegExp(character);
  }

  return new RegExp(`^${source}$`);
}

function normalizeGlobValue(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
