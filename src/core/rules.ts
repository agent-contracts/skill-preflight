import type { CategoryId, Finding, Rule, Severity, SkillContext, TextFile } from "./types.js";
import { estimateTokens, firstMatchLine } from "./utils.js";

interface PatternRule {
  id: string;
  category: CategoryId;
  severity: Severity;
  title: string;
  pattern: RegExp;
  description: string;
  recommendation: string;
  scoreImpact: number;
  pathPattern?: RegExp;
}

const securityPatterns: PatternRule[] = [
  {
    id: "security.remote-script-execution",
    category: "security",
    severity: "critical",
    title: "Remote script execution pattern",
    pattern: /(curl|wget|Invoke-WebRequest|iwr)\b.+(\|\s*(sh|bash|pwsh|powershell)|Invoke-Expression|\biex\b)/i,
    description: "The skill appears to download and execute remote code in one step.",
    recommendation: "Download artifacts separately, verify checksums, and require explicit user approval before execution.",
    scoreImpact: 14
  },
  {
    id: "security.invoke-expression",
    category: "security",
    severity: "high",
    title: "Dynamic PowerShell execution",
    pattern: /\b(Invoke-Expression|iex)\b/i,
    description: "Dynamic evaluation makes it hard to inspect what command will actually run.",
    recommendation: "Replace dynamic evaluation with explicit commands and documented arguments.",
    scoreImpact: 9
  },
  {
    id: "security.powershell-encoded-command",
    category: "security",
    severity: "high",
    title: "Encoded PowerShell command",
    pattern: /\b(powershell|pwsh)(\.exe)?\b.+-(enc|encodedcommand)\b/i,
    description: "Encoded PowerShell commands hide the operation from casual review.",
    recommendation: "Use readable commands and document every argument that needs elevated trust.",
    scoreImpact: 9
  },
  {
    id: "security.execution-policy-bypass",
    category: "security",
    severity: "medium",
    title: "PowerShell execution policy bypass",
    pattern: /\b(Set-ExecutionPolicy|ExecutionPolicy)\b.+\b(Bypass|Unrestricted)\b/i,
    description: "Bypassing execution policy lowers local script safeguards.",
    recommendation: "Avoid changing policy; document a manual, user-approved setup path instead.",
    scoreImpact: 6
  },
  {
    id: "security.shell-eval",
    category: "security",
    severity: "high",
    title: "Dynamic shell or JavaScript evaluation",
    pattern: /\b(eval|Function|exec)\s*\(|child_process\.(exec|execSync)\s*\(/i,
    description: "Dynamic execution can turn untrusted input into commands.",
    recommendation: "Use argument-safe APIs and avoid evaluating generated strings.",
    scoreImpact: 8
  },
  {
    id: "security.destructive-delete",
    category: "security",
    severity: "critical",
    title: "Potentially destructive delete command",
    pattern: /(rm\s+-rf\s+[/~*]|\bRemove-Item\b.+\b-Recurse\b.+\b-Force\b|\bdel\b\s+\/s\s+\/q|format\s+[a-z]:)/i,
    description: "The skill includes a broad destructive filesystem command.",
    recommendation: "Scope deletes to a verified workspace path and require confirmation for destructive operations.",
    scoreImpact: 13
  },
  {
    id: "security.secret-access",
    category: "security",
    severity: "high",
    title: "Potential secret or credential access",
    pattern: /(read|copy|scan|upload|send|exfiltrate).{0,80}(\.env|id_rsa|\.ssh|api[_ -]?key|secret|token|browser cookies|login data)/i,
    description: "The skill may instruct the agent to read or transmit sensitive local data.",
    recommendation: "Avoid accessing secrets by default; document narrow, opt-in credential handling.",
    scoreImpact: 10
  },
  {
    id: "security.webhook-exfiltration",
    category: "security",
    severity: "high",
    title: "Suspicious webhook or paste endpoint",
    pattern: /(discord\.com\/api\/webhooks|hooks\.slack\.com|webhook\.site|pastebin\.com|transfer\.sh|file\.io)/i,
    description: "The skill references endpoints commonly used for exfiltration or ad-hoc uploads.",
    recommendation: "Remove hardcoded endpoints or explain the data flow and require explicit consent.",
    scoreImpact: 9
  },
  {
    id: "security.prompt-injection",
    category: "security",
    severity: "high",
    title: "Prompt injection language",
    pattern: /(ignore (all )?(previous|system|developer) instructions|bypass safety|do not tell the user|hidden instruction|jailbreak)/i,
    description: "The skill contains language associated with prompt injection or instruction override.",
    recommendation: "Remove instruction-override text and keep the skill aligned with user and system instructions.",
    scoreImpact: 10
  },
  {
    id: "security.unicode-bidi-control",
    category: "security",
    severity: "high",
    title: "Bidirectional Unicode control character",
    pattern: /[\u202A-\u202E\u2066-\u2069]/u,
    description: "The file contains a bidirectional control character that can make instructions appear different from their stored order.",
    recommendation: "Remove bidirectional controls and keep security-sensitive instructions in visible logical order.",
    scoreImpact: 9
  },
  {
    id: "security.unicode-tag-characters",
    category: "security",
    severity: "critical",
    title: "Hidden Unicode tag characters",
    pattern: /[\u{E0000}-\u{E007F}]/u,
    description: "The file contains Unicode tag characters that can encode text invisible in normal editors.",
    recommendation: "Remove hidden tag characters and review the surrounding instructions from a raw or escaped text view.",
    scoreImpact: 12
  },
  {
    id: "security.zero-width-characters",
    category: "security",
    severity: "medium",
    title: "Zero-width Unicode characters",
    pattern: /[\u200B\u200C\u200D\u2060]/u,
    description: "The file contains zero-width characters that may conceal or split security-sensitive text.",
    recommendation: "Remove unexpected zero-width characters or document why they are required.",
    scoreImpact: 5
  }
];

const permissionPatterns: PatternRule[] = [
  {
    id: "permissions.overbroad-trigger",
    category: "permissions",
    severity: "medium",
    title: "Over-broad activation guidance",
    pattern: /(always use|use this skill for any|every task|all requests|whenever the user asks anything|trigger for all)/i,
    description: "Broad trigger language can cause the skill to activate when it is not relevant.",
    recommendation: "Narrow the trigger to concrete task types and domain-specific phrases.",
    scoreImpact: 6,
    pathPattern: /^SKILL\.md$/i
  },
  {
    id: "permissions.unbounded-filesystem",
    category: "permissions",
    severity: "medium",
    title: "Unbounded filesystem access",
    pattern: /(entire filesystem|whole disk|home directory|all files|scan everything|read every file)/i,
    description: "The skill asks for broad file access that may exceed its purpose.",
    recommendation: "Constrain file access to the current workspace or explicit user-selected paths.",
    scoreImpact: 5
  },
  {
    id: "permissions.unnecessary-network",
    category: "permissions",
    severity: "low",
    title: "Network use should be justified",
    pattern: /(send telemetry|analytics endpoint|phone home|remote logging|upload report)/i,
    description: "The skill appears to send data to a remote service.",
    recommendation: "Make network behavior opt-in and document what is transmitted.",
    scoreImpact: 4
  }
];

const compatibilityPatterns: PatternRule[] = [
  {
    id: "compatibility.hardcoded-user-path",
    category: "compatibility",
    severity: "medium",
    title: "Hardcoded local user path",
    pattern: /(C:\\Users\\[^\\\s]+|\/Users\/[^/\s]+|\/home\/[^/\s]+)/i,
    description: "Hardcoded local paths make the skill fragile across machines.",
    recommendation: "Use environment variables, workspace-relative paths, or user-provided paths.",
    scoreImpact: 3
  },
  {
    id: "compatibility.os-specific-command",
    category: "compatibility",
    severity: "low",
    title: "OS-specific command without fallback",
    pattern: /\b(osascript|open -a|xdg-open|Start-Process|powershell\.exe|cmd\.exe)\b/i,
    description: "The skill may rely on an OS-specific command.",
    recommendation: "Document supported platforms or provide cross-platform alternatives.",
    scoreImpact: 2
  }
];

export const rules: Rule[] = [
  patternRule("security.patterns", securityPatterns),
  patternRule("permissions.patterns", permissionPatterns),
  patternRule("compatibility.patterns", compatibilityPatterns),
  dependencyRule(),
  mcpConfigRule(),
  tokenRule(),
  footprintRule(),
  maintainabilityRule(),
  reliabilityRule()
];

function patternRule(id: string, patterns: PatternRule[]): Rule {
  return {
    id,
    run(context) {
      const findings: Finding[] = [];

      for (const file of context.textFiles) {
        for (const rule of patterns) {
          if (rule.pathPattern && !rule.pathPattern.test(file.path)) {
            continue;
          }

          const line = firstMatchLine(file.lines, rule.pattern);
          if (!line) {
            continue;
          }

          findings.push({
            id: rule.id,
            category: rule.category,
            severity: rule.severity,
            title: rule.title,
            description: rule.description,
            recommendation: rule.recommendation,
            scoreImpact: rule.scoreImpact,
            file: file.path,
            line
          });
        }
      }

      return findings;
    }
  };
}

function tokenRule(): Rule {
  return {
    id: "token.efficiency",
    run(context) {
      const findings: Finding[] = [];
      const skillFile = context.skillFile;

      if (!skillFile) {
        findings.push({
          id: "token.missing-skill-md",
          category: "token",
          severity: "critical",
          title: "Missing SKILL.md",
          description: "A skill cannot be evaluated properly without a SKILL.md entrypoint.",
          recommendation: "Add a SKILL.md with a concise description and progressive disclosure.",
          scoreImpact: 15
        });
        return findings;
      }

      const tokens = estimateTokens(skillFile.content);

      if (tokens > 4000) {
        findings.push({
          id: "token.skill-md-huge",
          category: "token",
          severity: "high",
          title: "SKILL.md is very large",
          description: `SKILL.md is estimated at ${tokens} activation tokens.`,
          recommendation: "Move detailed references into separate files and load them only when needed.",
          scoreImpact: 10,
          file: skillFile.path
        });
      } else if (tokens > 2200) {
        findings.push({
          id: "token.skill-md-large",
          category: "token",
          severity: "medium",
          title: "SKILL.md may be token-heavy",
          description: `SKILL.md is estimated at ${tokens} activation tokens.`,
          recommendation: "Keep core activation instructions short and move examples to references.",
          scoreImpact: 6,
          file: skillFile.path
        });
      }

      if (skillFile.bytes > 6000 && context.metrics.referenceFiles === 0) {
        findings.push({
          id: "token.no-progressive-disclosure",
          category: "token",
          severity: "medium",
          title: "No progressive disclosure structure",
          description: "The main skill file is large but no reference files were detected.",
          recommendation: "Split long background material into a references directory.",
          scoreImpact: 5,
          file: skillFile.path
        });
      }

      const duplicateLineCount = countDuplicateMeaningfulLines(skillFile);
      if (duplicateLineCount >= 6) {
        findings.push({
          id: "token.repeated-lines",
          category: "token",
          severity: "low",
          title: "Repeated content in SKILL.md",
          description: `${duplicateLineCount} repeated instruction lines were detected.`,
          recommendation: "Remove duplicated instructions to reduce activation cost and ambiguity.",
          scoreImpact: 3,
          file: skillFile.path
        });
      }

      return findings;
    }
  };
}

function footprintRule(): Rule {
  return {
    id: "footprint.size",
    run(context) {
      const findings: Finding[] = [];
      const totalMb = context.metrics.totalBytes / 1024 / 1024;

      if (totalMb > 20) {
        findings.push({
          id: "footprint.large-package",
          category: "footprint",
          severity: "high",
          title: "Large skill package",
          description: `The skill directory is ${totalMb.toFixed(1)} MB.`,
          recommendation: "Remove generated assets, vendored dependencies, and large binaries from the skill package.",
          scoreImpact: 8
        });
      } else if (totalMb > 5) {
        findings.push({
          id: "footprint.medium-package",
          category: "footprint",
          severity: "medium",
          title: "Skill package may be heavy",
          description: `The skill directory is ${totalMb.toFixed(1)} MB.`,
          recommendation: "Keep only the files needed at runtime and document optional assets separately.",
          scoreImpact: 4
        });
      }

      if (context.metrics.dependencyFiles > 0 && !hasLockfile(context)) {
        findings.push({
          id: "footprint.unlocked-dependencies",
          category: "footprint",
          severity: "medium",
          title: "Dependency manifest without lockfile",
          description: "A dependency manifest was found, but no lockfile was detected.",
          recommendation: "Commit a lockfile or pin exact versions for reproducible installs.",
          scoreImpact: 4
        });
      }

      if (context.metrics.scriptFiles > 8) {
        findings.push({
          id: "footprint.many-scripts",
          category: "footprint",
          severity: "low",
          title: "Many executable scripts",
          description: `${context.metrics.scriptFiles} script files were detected.`,
          recommendation: "Keep scripts minimal and document what each one does.",
          scoreImpact: 2
        });
      }

      return findings;
    }
  };
}

function dependencyRule(): Rule {
  return {
    id: "dependencies.manifests",
    run(context) {
      return [
        ...scanPackageJsonFiles(context),
        ...scanPythonRequirements(context)
      ];
    }
  };
}

function mcpConfigRule(): Rule {
  return {
    id: "mcp.config",
    run(context) {
      const findings: Finding[] = [];
      const mcpFiles = context.textFiles.filter((file) => isMcpConfigFile(file));

      for (const file of mcpFiles) {
        const parsed = parseJsonObject(file);

        if (!parsed) {
          findings.push({
            id: "mcp.invalid-json",
            category: "reliability",
            severity: "medium",
            title: "Invalid MCP JSON config",
            description: "The file looks like an MCP config but could not be parsed as JSON.",
            recommendation: "Fix JSON syntax so tools can inspect server commands and permissions.",
            scoreImpact: 3,
            file: file.path
          });
          continue;
        }

        const servers = getMcpServers(parsed);
        for (const [serverName, serverValue] of servers) {
          if (!isRecord(serverValue)) {
            continue;
          }

          const command = stringValue(serverValue.command);
          const args = Array.isArray(serverValue.args) ? serverValue.args.map(String) : [];
          const env = isRecord(serverValue.env) ? serverValue.env : {};

          if (command && /^(bash|sh|zsh|cmd|powershell|pwsh)(\.exe)?$/i.test(command)) {
            findings.push({
              id: "mcp.shell-server-command",
              category: "security",
              severity: "high",
              title: "MCP server launches through a shell",
              description: `MCP server "${serverName}" uses ${command}, which can obscure the actual command being executed.`,
              recommendation: "Launch a pinned executable directly and avoid shell string expansion.",
              scoreImpact: 8,
              file: file.path,
              line: firstMatchLine(file.lines, new RegExp(escapeRegExp(command), "i"))
            });
          }

          if (command && /^(npx|uvx|pipx)$/i.test(command) && !hasPinnedToolPackage(args)) {
            findings.push({
              id: "mcp.unpinned-tool-package",
              category: "footprint",
              severity: "medium",
              title: "Unpinned MCP server package",
              description: `MCP server "${serverName}" uses ${command} without a pinned package version.`,
              recommendation: "Pin the MCP server package version, for example package@1.2.3.",
              scoreImpact: 4,
              file: file.path,
              line: firstMatchLine(file.lines, /"args"\s*:/i)
            });
          }

          if (args.some((arg) => /(\/|\\|\b)(Users|home|root)(\/|\\|$)|C:\\Users\\/i.test(arg))) {
            findings.push({
              id: "mcp.broad-local-path",
              category: "permissions",
              severity: "medium",
              title: "MCP server references a broad local path",
              description: `MCP server "${serverName}" references a home or root-level path.`,
              recommendation: "Scope MCP server access to the current project or an explicit user-selected directory.",
              scoreImpact: 5,
              file: file.path
            });
          }

          const hardcodedSecretKeys = Object.entries(env).filter(
            ([key, value]) =>
              /(api[_-]?key|token|secret|password|credential)/i.test(key) &&
              typeof value === "string" &&
              value.trim().length > 0 &&
              !isEnvironmentReference(value)
          );
          if (hardcodedSecretKeys.length > 0) {
            findings.push({
              id: "mcp.hardcoded-secret-env",
              category: "security",
              severity: "high",
              title: "Hardcoded secret-like MCP environment value",
              description: `MCP server "${serverName}" defines secret-like environment keys: ${hardcodedSecretKeys.map(([key]) => key).join(", ")}.`,
              recommendation: "Read secrets from the user's environment instead of committing them in config files.",
              scoreImpact: 8,
              file: file.path
            });
          }
        }
      }

      return findings;
    }
  };
}

function maintainabilityRule(): Rule {
  return {
    id: "maintainability.basics",
    run(context) {
      const findings: Finding[] = [];

      if (!context.metrics.hasReadme) {
        findings.push({
          id: "maintainability.missing-readme",
          category: "maintainability",
          severity: "medium",
          title: "Missing README",
          description: "No README file was detected.",
          recommendation: "Add a README with purpose, installation, examples, and safety notes.",
          scoreImpact: 3
        });
      }

      if (!context.metrics.hasLicense) {
        findings.push({
          id: "maintainability.missing-license",
          category: "maintainability",
          severity: "medium",
          title: "Missing license",
          description: "No license file was detected.",
          recommendation: "Add a clear open-source license so users know whether they can install and reuse the skill.",
          scoreImpact: 3
        });
      }

      if (context.skillFile && !hasSkillFrontmatter(context.skillFile)) {
        findings.push({
          id: "maintainability.missing-frontmatter",
          category: "maintainability",
          severity: "low",
          title: "SKILL.md lacks metadata frontmatter",
          description: "The skill file does not appear to include name and description metadata.",
          recommendation: "Add frontmatter with name and description to make the skill discoverable.",
          scoreImpact: 2,
          file: context.skillFile.path
        });
      }

      return findings;
    }
  };
}

function reliabilityRule(): Rule {
  return {
    id: "reliability.evidence",
    run(context) {
      const findings: Finding[] = [];

      for (const file of context.files.filter((candidate) => candidate.readError)) {
        findings.push({
          id: "reliability.unreadable-file",
          category: "reliability",
          severity: "medium",
          title: "File could not be read",
          description: `The file could not be read (${file.readError}) and was excluded from text analysis.`,
          recommendation: "Inspect the file manually and check filesystem permissions or security software before installing the skill.",
          scoreImpact: 4,
          file: file.path
        });
      }

      if (!context.metrics.hasExamples) {
        findings.push({
          id: "reliability.missing-examples",
          category: "reliability",
          severity: "low",
          title: "No examples detected",
          description: "No examples directory or example files were detected.",
          recommendation: "Add small example tasks that show when and how the skill should be used.",
          scoreImpact: 3
        });
      }

      if (!context.metrics.hasTests) {
        findings.push({
          id: "reliability.missing-tests",
          category: "reliability",
          severity: "medium",
          title: "No tests or fixtures detected",
          description: "No tests, fixtures, or eval files were found.",
          recommendation: "Add fixtures or eval cases so users can verify the skill behavior before installing.",
          scoreImpact: 4
        });
      }

      if (context.skillFile) {
        const line = firstMatchLine(context.skillFile.lines, /\b(maybe|roughly|try to|do your best|whatever works)\b/i);
        if (line) {
          findings.push({
            id: "reliability.vague-instructions",
            category: "reliability",
            severity: "low",
            title: "Vague operational language",
            description: "The skill uses vague language that may reduce repeatability.",
            recommendation: "Prefer explicit inputs, outputs, and acceptance criteria.",
            scoreImpact: 2,
            file: context.skillFile.path,
            line
          });
        }
      }

      return findings;
    }
  };
}

function countDuplicateMeaningfulLines(file: TextFile): number {
  const seen = new Map<string, number>();

  for (const line of file.lines) {
    const normalized = line.trim().toLowerCase();
    if (normalized.length < 40 || normalized.startsWith("#")) {
      continue;
    }
    seen.set(normalized, (seen.get(normalized) ?? 0) + 1);
  }

  return [...seen.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

function hasLockfile(context: SkillContext): boolean {
  return context.files.some((file) =>
    /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|uv\.lock|poetry\.lock|Cargo\.lock|go\.sum)$/i.test(file.path)
  );
}

function hasSkillFrontmatter(file: TextFile): boolean {
  if (!file.content.startsWith("---")) {
    return false;
  }

  const end = file.content.indexOf("\n---", 3);
  if (end < 0) {
    return false;
  }

  const frontmatter = file.content.slice(3, end);
  return /(^|\n)name\s*:/i.test(frontmatter) && /(^|\n)description\s*:/i.test(frontmatter);
}

function scanPackageJsonFiles(context: SkillContext): Finding[] {
  const findings: Finding[] = [];
  const packageFiles = context.textFiles.filter((file) => /(^|\/)package\.json$/i.test(file.path));
  const lockfilePresent = hasLockfile(context);

  for (const file of packageFiles) {
    const parsed = parseJsonObject(file);
    if (!parsed) {
      findings.push({
        id: "dependencies.invalid-package-json",
        category: "reliability",
        severity: "medium",
        title: "Invalid package.json",
        description: "package.json could not be parsed.",
        recommendation: "Fix package.json so dependency and install-script risks can be inspected.",
        scoreImpact: 3,
        file: file.path
      });
      continue;
    }

    const scripts = isRecord(parsed.scripts) ? parsed.scripts : {};
    for (const scriptName of ["preinstall", "install", "postinstall", "prepare"]) {
      const script = stringValue(scripts[scriptName]);
      if (!script) {
        continue;
      }

      const lifecycleLine = firstMatchLine(file.lines, new RegExp(`"${scriptName}"\\s*:`, "i"));
      findings.push({
        id: "dependencies.lifecycle-script",
        category: "security",
        severity: "medium",
        title: "npm lifecycle install script",
        description: `package.json defines a ${scriptName} script that runs during install or packaging.`,
        recommendation: "Avoid implicit install-time code execution; move setup to explicit user-run commands.",
        scoreImpact: 5,
        file: file.path,
        line: lifecycleLine
      });

      if (/(curl|wget|Invoke-WebRequest|iwr).+(\|\s*(sh|bash|pwsh|powershell)|Invoke-Expression|\biex\b)|\beval\b|child_process\.(exec|execSync)/i.test(script)) {
        findings.push({
          id: "dependencies.dangerous-lifecycle-script",
          category: "security",
          severity: "high",
          title: "Dangerous npm lifecycle script",
          description: `${scriptName} contains dynamic or remote code execution.`,
          recommendation: "Remove remote execution from lifecycle scripts and require explicit user consent.",
          scoreImpact: 9,
          file: file.path,
          line: lifecycleLine
        });
      }
    }

    const dependencyFindings = collectUnpinnedNodeDependencies(file, parsed, lockfilePresent);
    findings.push(...dependencyFindings);
  }

  return findings;
}

function scanPythonRequirements(context: SkillContext): Finding[] {
  const findings: Finding[] = [];
  const requirementFiles = context.textFiles.filter((file) => /(^|\/)requirements[^/]*\.txt$/i.test(file.path));

  for (const file of requirementFiles) {
    const unpinned: string[] = [];
    const remoteRefs: string[] = [];

    file.lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-r ") || trimmed.startsWith("--")) {
        return;
      }

      if (/(git\+|https?:\/\/)/i.test(trimmed)) {
        remoteRefs.push(`${trimmed} at line ${index + 1}`);
        return;
      }

      if (!/[<>=!~]=/.test(trimmed)) {
        unpinned.push(`${trimmed} at line ${index + 1}`);
      }
    });

    if (remoteRefs.length > 0) {
      findings.push({
        id: "dependencies.python-remote-reference",
        category: "security",
        severity: "high",
        title: "Python dependency uses remote URL",
        description: `requirements file includes remote dependency references: ${remoteRefs.slice(0, 3).join(", ")}.`,
        recommendation: "Use pinned package versions from a trusted index, or pin Git URLs to immutable commits.",
        scoreImpact: 8,
        file: file.path,
        line: Number(remoteRefs[0]?.match(/line (\d+)/)?.[1])
      });
    }

    if (unpinned.length > 0) {
      findings.push({
        id: "dependencies.python-unpinned",
        category: "footprint",
        severity: "medium",
        title: "Unpinned Python dependencies",
        description: `requirements file includes unpinned packages: ${unpinned.slice(0, 5).join(", ")}.`,
        recommendation: "Pin versions or use a lockfile for reproducible installs.",
        scoreImpact: 4,
        file: file.path,
        line: Number(unpinned[0]?.match(/line (\d+)/)?.[1])
      });
    }
  }

  return findings;
}

function collectUnpinnedNodeDependencies(
  file: TextFile,
  parsed: Record<string, unknown>,
  lockfilePresent: boolean
): Finding[] {
  const findings: Finding[] = [];
  const dependencyGroups = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  const remoteSpecs: string[] = [];
  const localSpecs: string[] = [];
  const looseSpecs: string[] = [];

  for (const group of dependencyGroups) {
    const deps = isRecord(parsed[group]) ? parsed[group] : {};

    for (const [name, value] of Object.entries(deps)) {
      const spec = String(value);
      if (/^(git\+|https?:)/i.test(spec)) {
        remoteSpecs.push(`${name}@${spec}`);
      } else if (/^(file:|link:)/i.test(spec)) {
        localSpecs.push(`${name}@${spec}`);
      } else if (
        spec === "*" ||
        /^latest$/i.test(spec) ||
        (!lockfilePresent && /^[\^~]/.test(spec))
      ) {
        looseSpecs.push(`${name}@${spec}`);
      }
    }
  }

  if (remoteSpecs.length > 0) {
    findings.push({
      id: "dependencies.node-remote-spec",
      category: "security",
      severity: "high",
      title: "Node dependency uses remote spec",
      description: `package.json includes remote dependency specs: ${remoteSpecs.slice(0, 5).join(", ")}.`,
      recommendation: "Use trusted registry packages, or pin remote specs to immutable commits.",
      scoreImpact: 8,
      file: file.path
    });
  }

  if (localSpecs.length > 0) {
    findings.push({
      id: "dependencies.node-local-spec",
      category: "compatibility",
      severity: "medium",
      title: "Node dependency uses local path spec",
      description: `package.json includes local dependency specs that may not exist on another machine: ${localSpecs.slice(0, 5).join(", ")}.`,
      recommendation: "Publish the dependency, bundle it with the skill, or document the required workspace layout.",
      scoreImpact: 3,
      file: file.path
    });
  }

  if (looseSpecs.length > 0) {
    findings.push({
      id: "dependencies.node-loose-version",
      category: "footprint",
      severity: "medium",
      title: "Loose Node dependency versions",
      description: `package.json includes loose dependency specs: ${looseSpecs.slice(0, 5).join(", ")}.`,
      recommendation: lockfilePresent
        ? "Replace wildcard or latest dependency specs with bounded versions."
        : "Pin exact dependency versions or commit a lockfile for reproducible installs.",
      scoreImpact: 4,
      file: file.path
    });
  }

  return findings;
}

function isMcpConfigFile(file: TextFile): boolean {
  return /(^|\/)(\.?mcp.*\.json|claude_desktop_config\.json|mcp_servers\.json)$/i.test(file.path) || /"mcpServers"\s*:/.test(file.content);
}

function parseJsonObject(file: TextFile): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(file.content);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function getMcpServers(parsed: Record<string, unknown>): Array<[string, unknown]> {
  if (isRecord(parsed.mcpServers)) {
    return Object.entries(parsed.mcpServers);
  }

  if (isRecord(parsed.servers)) {
    return Object.entries(parsed.servers);
  }

  return [];
}

function hasPinnedToolPackage(args: string[]): boolean {
  return args.some((arg) => {
    if (arg.startsWith("-")) {
      return false;
    }

    return /^(@[^/]+\/)?[^@\s]+@\d+\.\d+\.\d+/.test(arg);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isEnvironmentReference(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^\$\{(?:env:)?[A-Z_][A-Z0-9_]*\}$/i.test(trimmed) ||
    /^\$env:[A-Z_][A-Z0-9_]*$/i.test(trimmed) ||
    /^\$[A-Z_][A-Z0-9_]*$/i.test(trimmed) ||
    /^%[A-Z_][A-Z0-9_]*%$/i.test(trimmed) ||
    /^\{\{\s*[A-Z_][A-Z0-9_]*\s*\}\}$/i.test(trimmed) ||
    /^<(?:YOUR_)?[A-Z_][A-Z0-9_]*>$/i.test(trimmed) ||
    /^(?:YOUR_|REPLACE_ME|CHANGEME)[A-Z0-9_-]*$/i.test(trimmed)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
