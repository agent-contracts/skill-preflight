# Policy Configuration

SkillPreflight can apply an explicit JSON policy when a project contains generated fixtures, platform-specific code, or reviewed findings.

## Example

```json
{
  "exclude": [
    "fixtures/**",
    "vendor/**",
    "**/*.generated.js"
  ],
  "ignoreRules": [
    "compatibility.os-specific-command",
    "reliability.*"
  ],
  "failBelow": 70,
  "failOn": "high"
}
```

Run it with:

```bash
skill-preflight scan . --config skill-preflight.json
```

The scanner does not discover config files automatically. A policy must be selected explicitly so a remote repository cannot silently weaken its own scan.

## Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `exclude` | `string[]` | Target-relative path globs that are not discovered or read. |
| `ignoreRules` | `string[]` | Exact rule IDs or wildcard patterns whose findings are suppressed. |
| `failBelow` | `number` | Fail when any active skill score is below this value from 0 to 100. |
| `failOn` | `string` | Fail for active findings at or above `info`, `low`, `medium`, `high`, or `critical`. |
| `maxTokens` | `number` | Optional positive safe integer; fail when any skill's estimated activation tokens exceed it. |

`*` matches within one path segment and `**` crosses directories. Rule patterns also support `*`, such as `compatibility.*`.

CLI `--exclude` and `--ignore-rule` values are merged with the policy. CLI `--fail-below` and `--fail-on` values override policy gates.

CLI `--max-tokens` overrides `maxTokens`. Exactly matching the budget passes. Budget gates evaluate all scanned skills, including those hidden by summary mode, and are independent of finding suppression. Reports are written before a budget failure returns exit code 1. This estimates instruction length, not actual model usage or billing.

Policy files may be UTF-8 with or without a BOM. `failBelow` and `maxTokens` must be JSON numbers; values such as `null`, `false`, `""`, or `"70"` are rejected rather than coerced. `failBelow` remains in the range 0-100; `maxTokens` must be a positive safe integer.

The GitHub Action follows the same precedence. If `config` is supplied and the `fail-below` input is omitted, the policy's `failBelow` value is preserved. With neither setting, the Action uses its default gate of 70.

## Suppression Visibility

Suppressed findings do not reduce the score or trigger severity gates. They remain in JSON reports under `suppressedFindings`, and every report includes a suppressed finding count.

Prefer narrow rule IDs and path exclusions. Broad patterns such as `security.*` can hide important signals and should be reserved for controlled testing.

## GitHub Action

```yaml
- uses: agent-contracts/skill-preflight@v1
  with:
    target: "."
    config: skill-preflight.json
    fail-below: "70"
    fail-on: high
```

Action inputs `exclude` and `ignore-rules` accept newline-separated values:

```yaml
- uses: agent-contracts/skill-preflight@v1
  with:
    target: "."
    exclude: |
      fixtures/**
      vendor/**
    ignore-rules: |
      compatibility.os-specific-command
```
