<p align="center">
  <img src="https://raw.githubusercontent.com/agent-contracts/skill-preflight/main/assets/skill-preflight-avatar.png" width="160" alt="SkillPreflight 盾牌与评分环标志">
</p>

# SkillPreflight

![SkillPreflight 社交预览图](https://raw.githubusercontent.com/agent-contracts/skill-preflight/main/assets/skill-preflight-social.png)

[![npm version](https://img.shields.io/npm/v/skill-preflight?color=16a34a)](https://www.npmjs.com/package/skill-preflight)
[![npm downloads](https://img.shields.io/npm/dm/skill-preflight?color=0891b2)](https://www.npmjs.com/package/skill-preflight)
[![CI](https://github.com/agent-contracts/skill-preflight/actions/workflows/ci.yml/badge.svg)](https://github.com/agent-contracts/skill-preflight/actions/workflows/ci.yml)
[![GitHub Marketplace](https://img.shields.io/badge/GitHub%20Marketplace-SkillPreflight-2ea44f?logo=github)](https://github.com/marketplace/actions/skillpreflight)
[![License](https://img.shields.io/github/license/agent-contracts/skill-preflight)](LICENSE)

[English](README.md) | [简体中文](README.zh-CN.md)

SkillPreflight 是一个面向 AI Agent Skill 的安装前安全、Token 和可维护性评分工具。

它可以帮助用户在安装 Codex、Claude Code、Cursor、Gemini CLI 或其他智能体 Skill 之前，先判断这个 Skill 是否安全、轻量、清晰，并且是否值得安装。

如果 SkillPreflight 帮助你检查了第三方 Skill，欢迎为项目点一个 Star，让更多用户在安装前先看清风险。

**一条命令即可使用，无需账号、API Key 或全局安装，也不会执行被扫描 Skill 中的代码。**

> **公开基准数据：** 2026 年 9 月的一组可复现快照选取了 100 个公开 Skill 目录，其中 97 个成功完成扫描。在这 97 个目录中，97 个没有包含测试，93 个没有示例，13 个触发了敏感信息访问复核项，11 个超过高 Token 体积阈值。详见[原始数据、方法与限制](benchmarks/2026-09-public-skills/README.md)。

## 为什么需要 SkillPreflight？

AI Agent 生态正在快速发展，越来越多的能力被封装成 Skill：写代码、查资料、生成内容、调用浏览器、连接 MCP 工具、执行项目工作流。

Skill 让智能体更强，但也带来了新的问题：

- 这个 Skill 会不会读取敏感文件？
- 有没有远程脚本执行、危险删除命令或可疑 webhook？
- 它会不会过度消耗 Token？
- 文件和依赖是不是太重？
- 说明、许可证、示例和测试是否足够清楚？
- 普通用户安装之前怎么判断风险？

SkillPreflight 的目标就是在安装前做一次静态体检，让用户有一个更客观的参考。

## 快速开始

可以先扫描项目内故意设计为高风险的测试样例，直接查看真实输出：

```bash
npx skill-preflight@latest scan https://github.com/agent-contracts/skill-preflight/tree/main/examples/risky-skill
```

无需全局安装，直接运行：

```bash
npx skill-preflight scan ./my-skill
```

安装前扫描 GitHub 仓库：

```bash
npx skill-preflight scan https://github.com/user/some-skill
```

如果只想检查大型仓库中的一个 Skill，可以直接粘贴 GitHub 目录链接或 `SKILL.md` 文件链接：

```bash
npx skill-preflight scan https://github.com/user/skills/tree/main/skills/my-skill
npx skill-preflight scan https://github.com/user/skills/blob/main/skills/my-skill/SKILL.md
```

![SkillPreflight CLI 演示](https://raw.githubusercontent.com/agent-contracts/skill-preflight/main/assets/skill-preflight-demo.png)

扫描常见的本地 Skill 安装目录：

```bash
npx skill-preflight scan --installed
```

安装目录发现会同时检查用户级和工作区级的共享 Agent Skills 目录，以及 Codex、Claude Code、Cursor、Gemini CLI 目录：`.agents/skills`、`.codex/skills`、`.claude/skills`、`.cursor/skills`、`.gemini/skills`。Windows、macOS 和 Linux 上通过链接方式安装的 Skill 也可以被识别。

如果仓库包含大量 Skill，可以只查看总览和分数最低的 20 项：

```bash
npx skill-preflight scan https://github.com/user/skill-collection --summary --top 20
```

使用本地策略文件控制排除项、误报和 CI 阈值：

```bash
npx skill-preflight scan . --config skill-preflight.json
```

生成 JSON 报告：

```bash
npx skill-preflight scan ./my-skill --format json --out report.json
```

生成 SARIF 报告，用于 GitHub Code Scanning：

```bash
npx skill-preflight scan ./my-skill --format sarif --out skill-preflight.sarif
```

## 安装为 Agent Skill

也可以把配套 Skill 安装到 Codex、Claude Code 等智能体中，让智能体在安装其他 Skill 前主动运行检查：

```bash
npx skills add agent-contracts/skill-preflight --skill skill-preflight
```

配套 Skill 会先扫描、单独强调严重发现，并在真正安装前要求确认。源码位于 [`skills/skill-preflight`](skills/skill-preflight/SKILL.md)。

## 评分模型

SkillPreflight 使用 100 分评分模型：

| 维度 | 分值 | 检查内容 |
| --- | ---: | --- |
| 安全性 | 35 | 危险命令、密钥访问、数据外传、提示词注入、远程脚本执行 |
| 权限克制 | 15 | 过宽激活条件、不必要的 shell、网络或文件访问 |
| Token 经济性 | 15 | 过大的 `SKILL.md`、重复内容、不合理的渐进式披露 |
| 轻量程度 | 10 | 文件数量、总体大小、依赖数量、大型资源文件 |
| 可维护性 | 10 | README、许可证、frontmatter、示例和文档卫生 |
| 可靠性 | 10 | 测试、fixtures、确定性工作流、错误处理 |
| 兼容性 | 5 | 硬编码本地路径、系统相关假设、脆弱 shell 用法 |

同一规则在多个文件中的命中仍会全部显示，但每个规则 ID 对单个 Skill 只扣分一次，避免大型仓库因为同类问题重复出现而被过度扣分。

如果一个 Skill 目录中还包含其他 Skill，SkillPreflight 会分别报告每个 `SKILL.md`，并在父级评分中自动排除子 Skill 的文件，避免互相污染分数。

评分示例：

```text
safe-doc-review: 100/100 (A) - Recommended
shell-super-agent: 25/100 (F) - High risk, do not install blindly
```

## CLI 用法

```bash
skill-preflight scan <target>
```

查看规则目录以及 `--ignore-rule` 可使用的规则 ID：

```bash
skill-preflight rules
```

常用参数：

```text
--installed             扫描常见的本地 Skill 安装目录。
--format <format>       输出格式：text、json、markdown、html 或 sarif。默认 text。
--out <file>            将报告写入文件。
--fail-below <score>    如果任意 Skill 分数低于该阈值，则以退出码 1 结束。
--fail-on <severity>    如果发现达到指定严重级别则失败，可用 info、low、medium、high、critical。
--config <file>         显式加载 JSON 策略文件。
--exclude <glob>        排除相对于扫描目标的路径，可重复使用。
--ignore-rule <id>      抑制规则 ID 或通配模式，可重复使用。
--keep-temp             保留临时 GitHub 下载目录，方便调试。
--summary               仅显示总体结果和分数最低的 Skill。
--top <count>           --summary 模式下显示的 Skill 数量。默认 20。
```

精简摘要支持 text、JSON、Markdown 和 HTML；用于代码扫描的 SARIF 始终保留全部发现。

## 策略和 CI 门禁

策略文件适合排除生成文件、测试夹具以及已经人工确认的误报：

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

SkillPreflight 不会自动加载被扫描仓库中的配置，必须由用户显式指定，防止不可信的远程 Skill 自行隐藏风险。被抑制的发现不会扣分或触发门禁，但会保留在 JSON 报告中并计入“已抑制发现”数量。

完整配置说明请参考 `docs/policy.md`。

生成 Shields 兼容的 badge JSON：

```bash
skill-preflight badge ./my-skill --out skill-preflight-badge.json
```

示例 badge payload：

```json
{
  "schemaVersion": 1,
  "label": "SkillPreflight",
  "message": "91/100 A",
  "color": "brightgreen"
}
```

JSON 扫描报告会记录报告结构版本、SkillPreflight 版本和相对 Skill 路径，不再输出内部绝对路径或临时下载目录。详见 [JSON 报告结构](docs/report-schema.md)。

## GitHub Action

SkillPreflight 已发布到 GitHub Marketplace。Skill 作者可以在每次 PR 或 push 时自动扫描：

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

未指定配置文件时，Action 默认在分数低于 70 时失败；指定 `config` 后会采用策略文件中的 `failBelow`，而显式填写的 `fail-below` 始终具有最高优先级。

如果需要 GitHub Code Scanning，可以输出 SARIF：

```bash
skill-preflight scan . --format sarif --out skill-preflight.sarif
```

完整工作流请参考 `docs/github-action.md`。

## 公开 Skill 基准报告

2026 年 9 月，SkillPreflight 选取了一组固定到具体 commit 的 100 个公开 Agent Skill 目录，其中 97 个成功完成扫描。成功样本平均分为 **80.5/100**，中位数为 **85/100**。

![SkillPreflight 公开 Skill 基准报告](https://raw.githubusercontent.com/agent-contracts/skill-preflight/main/benchmarks/2026-09-public-skills/benchmark-summary.svg)

查看[可复现的完整基准报告](benchmarks/2026-09-public-skills/README.md)，可了解抽样方法、汇总结果、固定样本、原始 JSON/CSV 数据与未能获取的样本错误记录。这是一组便利样本，不代表整个生态的排名；静态分析结果仍需人工复核。

## 安全原则

SkillPreflight 不会执行被扫描 Skill 里的脚本。超大文件只统计体积，不会整块载入文本分析。

它只读取文件并进行静态分析，重点识别潜在风险，例如：

- 远程脚本执行，例如 `curl ... | sh`
- 可疑敏感文件访问，例如 `.env`、SSH key、浏览器 Cookie
- 数据外传，例如 webhook 上传
- 破坏性命令，例如 `rm -rf`
- 提示词注入语言，例如要求忽略系统指令
- 过重文件、过长提示词和不必要依赖

## 示例输出

```text
shell-super-agent: 25/100 (F) - High risk, do not install blindly

Top findings:
- [CRITICAL] Remote script execution pattern (SKILL.md:15)
- [HIGH] Prompt injection language (SKILL.md:8)
- [HIGH] Potential secret or credential access (SKILL.md:10)
```

## 适合谁使用？

SkillPreflight 适合三类用户：

- 普通 AI Agent 用户：安装别人写的 Skill 前先检查风险。
- Skill 作者：用评分报告展示自己的 Skill 安全、轻量、可维护。
- 团队和企业：在内部 Skill 合并或发布前加入自动检查。

## 规则目录

当前静态分析规则请参考 `docs/rules.md`，其中包含依赖、安装脚本、MCP 配置、Token 和兼容性相关检查。

## 参与贡献

欢迎提交规则建议、误报样例、测试夹具和集成优化，详见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全漏洞请按照 [SECURITY.md](SECURITY.md) 私下报告，不要直接创建公开 Issue。

本地开发与发布前检查：

```bash
npm ci
npm test
npm run test:coverage
npm pack --dry-run
```

## 发布流程

首次 npm 和 GitHub release checklist 请参考 `docs/release.md`。

## 项目地址

- GitHub: https://github.com/agent-contracts/skill-preflight
- npm: https://www.npmjs.com/package/skill-preflight
- GitHub Marketplace: https://github.com/marketplace/actions/skillpreflight
