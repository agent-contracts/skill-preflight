# SkillPreflight

[English](README.md) | [简体中文](README.zh-CN.md)

SkillPreflight is a pre-install safety, token, and maintainability scorecard for AI agent skills.

It helps users decide whether a Codex, Claude Code, Cursor, Gemini CLI, or other agent skill is safe and lightweight enough to install.

## Quick Start

Run without installing:

```bash
npx skill-preflight scan ./my-skill
```

Scan a GitHub repository before installing it:

```bash
npx skill-preflight scan https://github.com/user/some-skill
```

Scan common local skill directories:

```bash
npx skill-preflight scan --installed
```

## Local Development

```bash
npm install
npm run build
npm test
npm run dev -- scan examples/risky-skill
```

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

## CLI

```bash
skill-preflight scan <target>
```

Options:

```text
--installed             Scan common installed skill directories.
--format <format>       text, json, markdown, html, or sarif. Default: text.
--out <file>            Write report to a file.
--fail-below <score>    Exit with code 1 if any scanned skill is below this score.
--keep-temp             Keep temporary clones for debugging.
```

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

## GitHub Action

After the package is published to npm and the repository is tagged, skill authors can scan every PR:

```yaml
name: SkillPreflight

on: [pull_request, push]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: agent-contracts/skill-preflight@v1
        with:
          target: "."
          fail-below: "70"
```

For GitHub code scanning, emit SARIF:

```bash
skill-preflight scan . --format sarif --out skill-preflight.sarif
```

See `docs/github-action.md` for the full workflow.

## Safety Principle

SkillPreflight does not execute scripts inside scanned skills. It only reads files and performs static analysis.

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

## Publishing

See `docs/release.md` for the first npm and GitHub release checklist.
