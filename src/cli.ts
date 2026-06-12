import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { scan } from "./core/scan.js";
import { parseFormat, renderReport } from "./report/render.js";

interface ScanCommandOptions {
  installed?: boolean;
  format?: string;
  out?: string;
  failBelow?: string;
  keepTemp?: boolean;
}

interface BadgeCommandOptions {
  installed?: boolean;
  out?: string;
  keepTemp?: boolean;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name("skill-preflight")
    .description("Pre-install safety, token, and maintainability scorecard for AI agent skills.")
    .version("0.1.3");

  program
    .command("scan")
    .argument("[target]", "Local skill path or GitHub repository URL")
    .option("--installed", "Scan common installed skill directories")
    .option("--format <format>", "Report format: text, json, markdown, html, sarif", "text")
    .option("--out <file>", "Write report to a file")
    .option("--fail-below <score>", "Exit with code 1 if any skill score is below this threshold")
    .option("--keep-temp", "Keep temporary GitHub clones for debugging")
    .action(async (target: string | undefined, options: ScanCommandOptions) => {
      const format = parseFormat(options.format ?? "text");
      const report = await scan({
        target,
        installed: options.installed,
        keepTemp: options.keepTemp
      });
      const rendered = renderReport(report, format);

      if (options.out) {
        const outPath = path.resolve(options.out);
        await writeFile(outPath, rendered, "utf8");
        process.stdout.write(`Wrote ${format} report to ${outPath}\n`);
      } else {
        process.stdout.write(rendered);
      }

      if (options.failBelow !== undefined) {
        const threshold = Number(options.failBelow);
        if (!Number.isFinite(threshold)) {
          throw new Error(`Invalid --fail-below value: ${options.failBelow}`);
        }

        const failed = report.reports.some((skill) => skill.score < threshold);
        if (failed) {
          process.exitCode = 1;
        }
      }
    });

  program
    .command("badge")
    .argument("[target]", "Local skill path or GitHub repository URL")
    .option("--installed", "Scan common installed skill directories")
    .option("--out <file>", "Write Shields endpoint JSON to a file")
    .option("--keep-temp", "Keep temporary GitHub clones for debugging")
    .action(async (target: string | undefined, options: BadgeCommandOptions) => {
      const report = await scan({
        target,
        installed: options.installed,
        keepTemp: options.keepTemp
      });
      const badge = renderBadge(report.summary.averageScore, report.summary.highRiskCount);
      const rendered = `${JSON.stringify(badge, null, 2)}\n`;

      if (options.out) {
        const outPath = path.resolve(options.out);
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
