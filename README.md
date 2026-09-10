<p align="center">
  <img src="https://raw.githubusercontent.com/agent-contracts/skill-preflight/main/assets/skill-preflight-avatar.png" width="160" alt="SkillPreflight shield and score ring logo">
</p>

# SkillPreflight

![SkillPreflight social preview](https://raw.githubusercontent.com/agent-contracts/skill-preflight/main/assets/skill-preflight-social.png)

[![npm version](https://img.shields.io/npm/v/skill-preflight?color=16a34a)](https://www.npmjs.com/package/skill-preflight)
[![npm downloads](https://img.shields.io/npm/dm/skill-preflight?color=0891b2)](https://www.npmjs.com/package/skill-preflight)
[![CI](https://github.com/agent-contracts/skill-preflight/actions/workflows/ci.yml/badge.svg)](https://github.com/agent-contracts/skill-preflight/actions/workflows/ci.yml)
[![GitHub Marketplace](https://img.shields.io/badge/GitHub%20Marketplace-SkillPreflight-2ea44f?logo=github)](https://github.com/marketplace/actions/skillpreflight)
[![License](https://img.shields.io/github/license/agent-contracts/skill-preflight)](LICENSE)

[English](README.md) | [简体中文](README.zh-CN.md)

SkillPreflight is a pre-install safety, token, and maintainability scorecard for AI agent skills.

It helps users decide whether a Codex, Claude Code, Cursor, Gemini CLI, or other agent skill is safe and lightweight enough to install.

If SkillPreflight helps you vet a third-party skill, consider starring the repository so more users can discover safer pre-install checks.

**One command, no account or API key, no global install, and no execution of code from the scanned skill.**

> **Public benchmark:** A reproducible September 2026 snapshot selected 100 public skill directories; 97 scanned successfully. Of those 97, 97 lacked bundled tests, 93 lacked examples, 13 triggered secret-access review findings, and 11 exceeded the high token-size threshold. Read the [data, methodology, and limitations](benchmarks/2026-09-public-skills/README.md).

## Quick Start

Try SkillPreflight against the repository's intentionally risky fixture:

```bash
npx skill-preflight@latest scan https://github.com/agent-contracts/skill-preflight/tree/main/examples/risky-skill
```

Run without installing:

```bash
npx skill-preflight scan ./my-skill
```

Scan a GitHub repository before installing it:

```bash
npx skill-preflight scan https://github.com/user/some-skill
```

Scan one skill inside a large repository by pasting its GitHub directory or `SKILL.md` URL:

```bash
npx skill-preflight scan https://github.com/user/skills/tree/main/skills/my-skill
npx skill-preflight scan https://github.com/user/skills/blob/main/skills/my-skill/SKILL.md
```

![SkillPreflight CLI demo](https://raw.githubusercontent.com/agent-contracts/skill-preflight/main/assets/skill-preflight-demo.png)

Scan common local skill directories:

```bash
npx skill-preflight scan --installed
```

Installed discovery covers user and workspace roots for the shared Agent Skills convention plus Codex, Claude Code, Cursor, and Gemini CLI: `.agents/skills`, `.codex/skills`, `.claude/skills`, `.cursor/skills`, and `.gemini/skills`. Linked skill directories are supported on Windows, macOS, and Linux.

For repositories containing many skills, show a compact list of the 20 lowest-scoring skills:

```bash
npx skill-preflight scan https://github.com/user/skill-collection --summary --top 20
```

Apply a local policy when scanning a repository:

```bash
npx skill-preflight scan . --config skill-preflight.json
```

## Install As An Agent Skill

Install the companion skill so an AI coding agent can run the pre-install audit workflow for you:

```bash
npx skills add agent-contracts/skill-preflight --skill skill-preflight
```

The companion skill scans first, surfaces severe findings independently of the aggregate score, and asks before installation. Its source is in [`skills/skill-preflight`](skills/skill-preflight/SKILL.md).

## Score Model

SkillPreflight uses a 100-point score:

| Category | Points | What it checks |
| --- | ---: | --- |
| Security | 35 | Dangerous commands, secret access, exfiltration, prompt injection, remote script execution |
| Permission restraint | 15 | Over-broad activation, unnecessary shell/network/file access |
| Token efficiency | 15 | Oversized `SKILL.md`, repeated content, poor progressive disclosure |
| Lightweight footprint | 10 | File count, total size, dependencies, large assets |
| Maintainability | 10 | README, license, frontmatter, examples, documentation hygiene |
| Reliability | 10 | Tests, fixtures, deterministic workflow, error handling |
| Compatibility | 5 | Hardcoded local paths, OS-specific assumptions, fragile shell usage |

Repeated locations for the same rule remain visible, but each rule ID deducts points only once per skill. This keeps large repositories from receiving a lower score merely because the same issue appears in several files.

When one skill directory contains other skills, SkillPreflight reports each `SKILL.md` as a separate skill and excludes child-skill files from the parent score.

## CLI

```bash
skill-preflight scan <target>
```

Print the rule catalog and the IDs accepted by `--ignore-rule`:

```bash
skill-preflight rules
```

Options:

```text
--installed             Scan common installed skill directories.
--format <format>       text, json, markdown, html, or sarif. Default: text.
--out <file>            Write report to a file.
--fail-below <score>    Exit with code 1 if any scanned skill is below this score.
--fail-on <severity>    Exit for findings at or above info, low, medium, high, or critical.
--config <file>         Load an explicit JSON policy file.
--exclude <glob>        Exclude a target-relative path glob. Repeat as needed.
--ignore-rule <id>      Suppress a rule ID or wildcard pattern. Repeat as needed.
--keep-temp             Keep temporary clones for debugging.
--summary               Show aggregate results and the lowest-scoring skills only.
--top <count>           Number of skills shown with --summary. Default: 20.
```

Summary mode supports text, JSON, Markdown, and HTML output. SARIF always contains the full set of findings for code scanning.

## Policy and CI Gates

Use an explicit JSON policy to keep generated files and reviewed false positives out of a scan:

```json
{
  "exclude": ["fixtures/**", "vendor/**"],
  "ignoreRules": ["compatibility.os-specific-command"],
  "failBelow": 70,
  "failOn": "high"
}
```

```bash
skill-preflight scan . --config skill-preflight.json
```

Config files are never loaded from a scanned repository automatically. This prevents an untrusted remote skill from suppressing its own findings. CLI exclusions and ignored rules are merged with the config; CLI score and severity gates take precedence.

Suppressed findings remain counted in the report so policy decisions are visible. See `docs/policy.md` for glob behavior and CI examples.

Generate Shields-compatible badge JSON:

```bash
skill-preflight badge ./my-skill --out skill-preflight-badge.json
```

The badge payload can be served through a static endpoint or GitHub Pages:

```json
{
  "schemaVersion": 1,
  "label": "SkillPreflight",
  "message": "91/100 A",
  "color": "brightgreen"
}
```

JSON scan reports include a schema version, the SkillPreflight version, and portable per-skill paths. Internal absolute and temporary paths are omitted. See the [JSON report schema](docs/report-schema.md).

## GitHub Action

After the package is published to npm and the repository is tagged, skill authors can scan every PR:

```yaml
name: SkillPreflight

on: [pull_request, push]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: agent-contracts/skill-preflight@v1
        with:
          target: "."
          config: skill-preflight.json
```

Without a config, the Action fails below 70 by default. A policy file's `failBelow` value is used when `config` is provided; an explicit `fail-below` input overrides both.

For GitHub code scanning, emit SARIF:

```bash
skill-preflight scan . --format sarif --out skill-preflight.sarif
```

See `docs/github-action.md` for the full workflow.

## Public Benchmark

In September 2026, SkillPreflight selected a frozen, commit-pinned sample of 100 public agent skill directories and scanned 97 successfully. The successful sample averaged **80.5/100**, with a median score of **85/100**.

![SkillPreflight public skill benchmark](https://raw.githubusercontent.com/agent-contracts/skill-preflight/main/benchmarks/2026-09-public-skills/benchmark-summary.svg)

Read the [reproducible benchmark report](benchmarks/2026-09-public-skills/README.md) for the methodology, aggregate findings, source snapshot, raw JSON/CSV data, and failed retrieval records. This convenience sample is not an ecosystem ranking, and static findings require manual review.

## Safety Principle

SkillPreflight does not execute scripts inside scanned skills. It only reads files and performs static analysis. Oversized files are measured without being loaded into text analysis.

## Example Output

```text
shell-super-agent: 35/100 (F) - High risk, do not install blindly

Top findings:
- [CRITICAL] Remote script execution pattern (SKILL.md:15)
- [HIGH] Prompt injection language (SKILL.md:8)
- [HIGH] Potential secret or credential access (SKILL.md:10)
```

## Rule Catalog

See `docs/rules.md` for the current static analysis rule catalog, including dependency, install-script, MCP config, token, and compatibility checks.

## Contributing

Rule ideas, false-positive examples, fixtures, and integration improvements are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Report security vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not a public issue.

Local development:

```bash
npm ci
npm test
npm run test:coverage
npm pack --dry-run
```

## Publishing

See `docs/release.md` for the first npm and GitHub release checklist.
