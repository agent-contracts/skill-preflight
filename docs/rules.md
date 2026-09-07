# Rule Catalog

SkillPreflight uses static analysis only. It reads files but does not execute skill scripts.

Print this catalog from an installed package with:

```bash
skill-preflight rules
```

The backticked identifiers below can be passed to `--ignore-rule` or included in `ignoreRules` policy entries.

## Security

- `security.remote-script-execution`: remote script execution, such as `curl ... | sh`.
- `security.invoke-expression`: dynamic PowerShell evaluation.
- `security.powershell-encoded-command`: encoded PowerShell commands.
- `security.execution-policy-bypass`: PowerShell execution policy bypasses.
- `security.shell-eval`: dynamic shell, Node.js, or JavaScript execution.
- `security.destructive-delete`: broad destructive delete commands.
- `security.secret-access`: secret-like local data access, including `.env`, SSH keys, API keys, browser cookies, and login data.
- `security.webhook-exfiltration`: suspicious webhook, paste, and ad-hoc upload endpoints.
- `security.prompt-injection`: phrases that attempt to override system or developer instructions.
- `security.unicode-bidi-control`: bidirectional Unicode controls that can reorder visible instructions.
- `security.unicode-tag-characters`: hidden Unicode tag characters.
- `security.zero-width-characters`: unexpected zero-width characters.

## Permission Restraint

- `permissions.overbroad-trigger`: activation guidance that tells the agent to use a skill for unrelated tasks.
- `permissions.unbounded-filesystem`: instructions to read or scan an entire home directory, disk, or filesystem.
- `permissions.unnecessary-network`: telemetry, remote logging, or report uploads that need clearer justification.

## Scoring Behavior

Every matching location remains in the report, but a rule ID deducts points only once per skill. This prevents repeated copies of the same issue from exhausting a category score while preserving the full audit trail.

Findings suppressed by an explicit policy do not deduct points. Reports retain the suppressed findings and their count.

## Dependency and Install Risk

- `dependencies.invalid-package-json`: package manifests that cannot be parsed.
- `dependencies.lifecycle-script`: npm lifecycle scripts: `preinstall`, `install`, `postinstall`, and `prepare`.
- `dependencies.dangerous-lifecycle-script`: lifecycle scripts that download or dynamically execute code.
- `dependencies.node-remote-spec`: Node dependencies using Git or HTTP URLs.
- `dependencies.node-local-spec`: Node dependencies using local `file:` or `link:` paths.
- `dependencies.node-loose-version`: wildcard, `latest`, or unlocked `^` and `~` Node versions.
- `dependencies.python-unpinned`: unpinned Python `requirements.txt` dependencies.
- `dependencies.python-remote-reference`: Python dependencies installed from remote URLs or Git repositories.
- `footprint.unlocked-dependencies`: dependency manifests without lockfiles.

Committed lockfiles satisfy normal `^` and `~` Node version ranges. Wildcard and `latest` specs remain findings even when a lockfile exists.

## MCP Config Risk

SkillPreflight detects common MCP JSON files, including `.mcp.json`, `mcp*.json`, and `claude_desktop_config.json`.

It flags:

- `mcp.invalid-json`: MCP configuration that cannot be parsed.
- `mcp.shell-server-command`: servers launched through a shell, such as `bash`, `sh`, `cmd`, or `powershell`.
- `mcp.unpinned-tool-package`: `npx`, `uvx`, and `pipx` servers without pinned package versions.
- `mcp.broad-local-path`: broad local paths such as user home directories.
- `mcp.hardcoded-secret-env`: literal secret-like values in MCP `env`.

Environment references such as `${API_KEY}`, `$env:API_KEY`, `$API_KEY`, and `%API_KEY%` are not treated as hardcoded secrets.

## Token Efficiency

- `token.skill-md-huge` and `token.skill-md-large`: oversized `SKILL.md` files.
- `token.no-progressive-disclosure`: large main skill files without a progressive disclosure structure.
- `token.repeated-lines`: repeated long instruction lines.
- `token.missing-skill-md`: missing skill entrypoint.

## Lightweight Footprint

- `footprint.large-package` and `footprint.medium-package`: large skill directories.
- `footprint.many-scripts`: unusually high executable-script counts.

## Reliability and Maintainability

- `maintainability.missing-readme`: missing README.
- `maintainability.missing-license`: missing license.
- `maintainability.missing-frontmatter`: missing skill metadata frontmatter.
- `reliability.missing-examples`: missing examples.
- `reliability.missing-tests`: missing tests, fixtures, or evals.
- `reliability.unreadable-file`: files blocked or removed before their contents could be analyzed.
- `reliability.vague-instructions`: vague operational language.

## Compatibility

- `compatibility.hardcoded-user-path`: hardcoded user paths.
- `compatibility.os-specific-command`: OS-specific commands without fallback guidance.
