import path from "node:path";
import { commonInstalledSkillDirs, discoverSkillRoots, readSkillFiles, resolveTarget } from "./filesystem.js";
import { suppressFindings, uniqueStrings } from "./policy.js";
import { rules } from "./rules.js";
import { scoreFindings, sortFindings } from "./scoring.js";
import type { ScanMetrics, ScanOptions, ScanReport, SkillContext, SkillReport } from "./types.js";
import { estimateTokens, pathExists } from "./utils.js";

const SCRIPT_FILE_PATTERN = /\.(sh|bash|zsh|ps1|bat|cmd|js|mjs|cjs|ts|py|rb|pl)$/i;
const DEPENDENCY_FILE_PATTERN =
  /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|Cargo\.toml|go\.mod|Gemfile|Pipfile)$/i;
const REFERENCE_FILE_PATTERN = /(^|\/)(references?|docs?|knowledge|examples?)\//i;
const ASSET_FILE_PATTERN = /\.(png|jpe?g|gif|webp|svg|pdf|zip|tar|gz|mp4|mov|mp3|wav|exe|dll|bin)$/i;

export async function scan(options: ScanOptions): Promise<ScanReport> {
  const targets = await resolveScanTargets(options);
  const reports: SkillReport[] = [];
  const exclude = uniqueStrings(options.exclude ?? []);
  const ignoreRules = uniqueStrings(options.ignoreRules ?? []);

  for (const target of targets) {
    const resolved = await resolveTarget(target, options.keepTemp);

    try {
      const roots = await discoverSkillRoots(resolved.localPath, exclude);
      if (roots.length === 0) {
        if (options.installed) {
          continue;
        }
        const suffix = exclude.length > 0 ? " after applying exclusions" : "";
        throw new Error(`No SKILL.md files found under ${target}${suffix}`);
      }

      for (const root of roots) {
        const nestedSkillExcludes = roots
          .filter((candidate) => isDescendantPath(root, candidate))
          .map((candidate) => `${toTargetRelativePath(resolved.localPath, candidate)}/**`);
        const displayPath = path.relative(resolved.localPath, root).split(path.sep).join("/") || ".";
        const report = await scanSkillRoot(root, resolved.displayTarget, {
          basePath: resolved.localPath,
          exclude: uniqueStrings([...exclude, ...nestedSkillExcludes]),
          ignoreRules
        });
        report.displayPath = displayPath;
        reports.push(report);
      }
    } finally {
      await resolved.cleanup?.();
    }
  }

  if (options.installed && reports.length === 0) {
    throw new Error("No SKILL.md files were found in common installed skill directories.");
  }

  return {
    generatedAt: new Date().toISOString(),
    target: options.installed ? "installed skills" : targets.join(", "),
    reports,
    summary: summarize(reports),
    policy: {
      exclude,
      ignoreRules
    }
  };
}

function isDescendantPath(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return (
    Boolean(relativePath) &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

function toTargetRelativePath(targetPath: string, candidatePath: string): string {
  return path.relative(targetPath, candidatePath).split(path.sep).join("/");
}

export interface ScanSkillRootOptions {
  basePath?: string;
  exclude?: string[];
  ignoreRules?: string[];
}

export async function scanSkillRoot(
  rootPath: string,
  target: string,
  options: ScanSkillRootOptions = {}
): Promise<SkillReport> {
  const { files, textFiles } = await readSkillFiles(rootPath, {
    basePath: options.basePath,
    exclude: options.exclude
  });
  const skillFile = textFiles.find((file) => file.path.toLowerCase() === "skill.md");
  const context: SkillContext = {
    rootPath,
    skillName: deriveSkillName(rootPath, skillFile?.content),
    files,
    textFiles,
    skillFile,
    metrics: buildMetrics(files, textFiles, skillFile)
  };

  const allFindings = sortFindings(rules.flatMap((rule) => rule.run(context)));
  const { active: findings, suppressed: suppressedFindings } = suppressFindings(
    allFindings,
    uniqueStrings(options.ignoreRules ?? [])
  );
  const scoring = scoreFindings(findings);

  return {
    target,
    rootPath,
    skillName: context.skillName,
    score: scoring.score,
    grade: scoring.grade,
    recommendation: scoring.recommendation,
    categories: scoring.categories,
    findings,
    suppressedFindings,
    metrics: context.metrics
  };
}

async function resolveScanTargets(options: ScanOptions): Promise<string[]> {
  if (options.installed) {
    const installedDirs = commonInstalledSkillDirs();
    const existingDirs: string[] = [];

    for (const dir of installedDirs) {
      if (await pathExists(dir)) {
        existingDirs.push(dir);
      }
    }

    if (existingDirs.length === 0) {
      throw new Error("No common installed skill directories were found.");
    }

    return existingDirs;
  }

  if (!options.target) {
    throw new Error("Missing target. Use: skill-preflight scan <path-or-github-url>");
  }

  return [options.target];
}

function buildMetrics(
  files: SkillContext["files"],
  textFiles: SkillContext["textFiles"],
  skillFile?: SkillContext["skillFile"]
): ScanMetrics {
  return {
    totalFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    textFiles: textFiles.length,
    scriptFiles: files.filter((file) => SCRIPT_FILE_PATTERN.test(file.path)).length,
    dependencyFiles: files.filter((file) => DEPENDENCY_FILE_PATTERN.test(file.path)).length,
    referenceFiles: files.filter((file) => REFERENCE_FILE_PATTERN.test(file.path)).length,
    assetFiles: files.filter((file) => ASSET_FILE_PATTERN.test(file.path)).length,
    skillMdBytes: skillFile?.bytes ?? 0,
    skillMdLines: skillFile?.lines.length ?? 0,
    estimatedActivationTokens: skillFile ? estimateTokens(skillFile.content) : 0,
    hasSkillMd: Boolean(skillFile),
    hasReadme: files.some((file) => /^README(\.[a-z0-9]+)?$/i.test(path.basename(file.path))),
    hasLicense: files.some((file) => /^LICEN[CS]E(\.[a-z0-9]+)?$/i.test(path.basename(file.path))),
    hasExamples: files.some((file) => /(^|\/)(examples?|samples?)\//i.test(file.path) || /example/i.test(file.path)),
    hasTests: files.some((file) => /(^|\/)(test|tests|fixtures?|evals?)\//i.test(file.path) || /\.(test|spec)\./i.test(file.path))
  };
}

function deriveSkillName(rootPath: string, skillContent = ""): string {
  const frontmatterMatch = skillContent.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const nameMatch = frontmatterMatch?.[1]?.match(/(^|\n)name\s*:\s*["']?([^"'\n]+)["']?/i);
  return nameMatch?.[2]?.trim() || path.basename(rootPath);
}

function summarize(reports: SkillReport[]): ScanReport["summary"] {
  if (reports.length === 0) {
    return {
      count: 0,
      averageScore: 0,
      minScore: 0,
      highRiskCount: 0,
      suppressedCount: 0
    };
  }

  const total = reports.reduce((sum, report) => sum + report.score, 0);
  return {
    count: reports.length,
    averageScore: Math.round(total / reports.length),
    minScore: Math.min(...reports.map((report) => report.score)),
    highRiskCount: reports.filter(
      (report) => report.score < 60 || report.findings.some((finding) => finding.severity === "critical")
    ).length,
    suppressedCount: reports.reduce((sum, report) => sum + report.suppressedFindings.length, 0)
  };
}
