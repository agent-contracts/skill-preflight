import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Command } from "commander";
import {
  loadConfig,
  parseScoreThreshold,
  parseSeverity,
  uniqueStrings
} from "./core/policy.js";
import { scan } from "./core/scan.js";
import type { ScanReport, Severity } from "./core/types.js";
import { severityRank } from "./core/utils.js";
import { parseFormat, renderReport } from "./report/render.js";

const require = createRequire(import.meta.url);
const packageMetadata = require("../package.json") as { version: string };

interface PolicyCommandOptions {
  config?: string;
  exclude?: string[];
  ignoreRule?: string[];
}

interface ScanCommandOptions extends PolicyCommandOptions {
  installed?: boolean;
  format?: string;
  out?: string;
  failBelow?: string;
  failOn?: string;
  keepTemp?: boolean;
  summary?: boolean;
  top?: string;
}

interface BadgeCommandOptions extends PolicyCommandOptions {
  installed?: boolean;
  out?: string;
  keepTemp?: boolean;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name("skill-preflight")
    .description("Pre-install safety, token, and maintainability scorecard for AI agent skills.")
    .version(packageMetadata.version);

  program
    .command("rules")
    .description("Print the rule catalog and rule IDs used by --ignore-rule")
    .action(async () => {
      const catalog = await readFile(new URL("../docs/rules.md", import.meta.url), "utf8");
      process.stdout.write(catalog.endsWith("\n") ? catalog : `${catalog}\n`);
    });

  program
    .command("scan")
    .argument("[target]", "Local skill path or GitHub repository URL")
    .option("--installed", "Scan common installed skill directories")
    .option("--format <format>", "Report format: text, json, markdown, html, sarif", "text")
    .option("--out <file>", "Write report to a file")
    .option("--fail-below <score>", "Exit with code 1 if any skill score is below this threshold")
    .option("--fail-on <severity>", "Exit with code 1 for findings at or above this severity")
    .option("--config <file>", "Load policy from an explicit JSON config file")
    .option("--exclude <glob>", "Exclude a target-relative path glob (repeatable)", collectOption, [])
    .option("--ignore-rule <rule-id>", "Suppress a finding rule or wildcard pattern (repeatable)", collectOption, [])
    .option("--keep-temp", "Keep temporary GitHub clones for debugging")
    .option("--summary", "Show a compact summary instead of full skill details")
    .option("--top <count>", "Number of lowest-scoring skills to include with --summary")
    .action(async (target: string | undefined, options: ScanCommandOptions) => {
      const format = parseFormat(options.format ?? "text");
      const config = await loadConfig(options.config);
      const exclude = uniqueStrings([...config.exclude, ...(options.exclude ?? [])]);
      const ignoreRules = uniqueStrings([...config.ignoreRules, ...(options.ignoreRule ?? [])]);
      const failBelow =
        options.failBelow === undefined
          ? config.failBelow
          : parseScoreThreshold(options.failBelow, "--fail-below");
      const failOn =
        options.failOn === undefined
          ? config.failOn
          : parseSeverity(options.failOn, "--fail-on");

      if (options.top !== undefined && !options.summary) {
        throw new Error("--top can only be used with --summary.");
      }

      const top = options.summary ? parsePositiveInteger(options.top ?? "20", "--top") : undefined;
      if (options.summary && format === "sarif") {
        throw new Error("--summary is not supported with --format sarif.");
      }

      const report = await scan({
        target,
        installed: options.installed,
        keepTemp: options.keepTemp,
        exclude,
        ignoreRules
      });
      const rendered = renderReport(report, format, {
        summary: options.summary,
        top
      });

      if (options.out) {
        const outPath = path.resolve(options.out);
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, rendered, "utf8");
        process.stdout.write(`Wrote ${format} report to ${outPath}\n`);
      } else {
        process.stdout.write(rendered);
      }

      const gateFailures = evaluateGates(report, failBelow, failOn);
      if (gateFailures.length > 0) {
        process.stderr.write(`${gateFailures.join("\n")}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command("badge")
    .argument("[target]", "Local skill path or GitHub repository URL")
    .option("--installed", "Scan common installed skill directories")
    .option("--out <file>", "Write Shields endpoint JSON to a file")
    .option("--config <file>", "Load policy from an explicit JSON config file")
    .option("--exclude <glob>", "Exclude a target-relative path glob (repeatable)", collectOption, [])
    .option("--ignore-rule <rule-id>", "Suppress a finding rule or wildcard pattern (repeatable)", collectOption, [])
    .option("--keep-temp", "Keep temporary GitHub clones for debugging")
    .action(async (target: string | undefined, options: BadgeCommandOptions) => {
      const config = await loadConfig(options.config);
      const report = await scan({
        target,
        installed: options.installed,
        keepTemp: options.keepTemp,
        exclude: uniqueStrings([...config.exclude, ...(options.exclude ?? [])]),
        ignoreRules: uniqueStrings([...config.ignoreRules, ...(options.ignoreRule ?? [])])
      });
      const badge = renderBadge(report.summary.averageScore, report.summary.highRiskCount);
      const rendered = `${JSON.stringify(badge, null, 2)}\n`;

      if (options.out) {
        const outPath = path.resolve(options.out);
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, rendered, "utf8");
        process.stdout.write(`Wrote badge JSON to ${outPath}\n`);
      } else {
        process.stdout.write(rendered);
      }
    });

  program.showHelpAfterError();

  try {
    await program.parseAsync(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${optionName} value: ${value}. Use a positive integer.`);
  }

  return parsed;
}

function evaluateGates(report: ScanReport, failBelow?: number, failOn?: Severity): string[] {
  const failures: string[] = [];

  if (failBelow !== undefined) {
    const belowThreshold = report.reports.filter((skill) => skill.score < failBelow);
    if (belowThreshold.length > 0) {
      failures.push(
        `SkillPreflight gate failed: ${belowThreshold.length} skill(s) scored below ${failBelow}; minimum score was ${report.summary.minScore}.`
      );
    }
  }

  if (failOn !== undefined) {
    const thresholdRank = severityRank(failOn);
    const matchingFindings = report.reports.flatMap((skill) =>
      skill.findings.filter((finding) => severityRank(finding.severity) >= thresholdRank)
    );

    if (matchingFindings.length > 0) {
      failures.push(
        `SkillPreflight gate failed: ${matchingFindings.length} finding(s) were ${failOn} severity or higher.`
      );
    }
  }

  return failures;
}

function renderBadge(score: number, highRiskCount: number): {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
} {
  return {
    schemaVersion: 1,
    label: "SkillPreflight",
    message: `${score}/100 ${badgeGrade(score)}`,
    color: highRiskCount > 0 ? "red" : badgeColor(score)
  };
}

function badgeGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function badgeColor(score: number): string {
  if (score >= 90) return "brightgreen";
  if (score >= 80) return "green";
  if (score >= 70) return "yellowgreen";
  if (score >= 60) return "orange";
  return "red";
}
