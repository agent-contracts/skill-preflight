# SkillPreflight

[English](README.md) | [简体中文](README.zh-CN.md)

SkillPreflight 是一个面向 AI Agent Skill 的安装前安全、Token 和可维护性评分工具。

它可以帮助用户在安装 Codex、Claude Code、Cursor、Gemini CLI 或其他智能体 Skill 之前，先判断这个 Skill 是否安全、轻量、清晰，并且是否值得安装。

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

无需全局安装，直接运行：

```bash
npx skill-preflight scan ./my-skill
```

安装前扫描 GitHub 仓库：

```bash
npx skill-preflight scan https://github.com/user/some-skill
```

扫描常见的本地 Skill 安装目录：

```bash
npx skill-preflight scan --installed
```

生成 JSON 报告：

```bash
npx skill-preflight scan ./my-skill --format json --out report.json
```

生成 SARIF 报告，用于 GitHub Code Scanning：

```bash
npx skill-preflight scan ./my-skill --format sarif --out skill-preflight.sarif
```

## 本地开发

```bash
npm install
npm run build
npm test
npm run dev -- scan examples/risky-skill
```

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

评分示例：

```text
safe-doc-review: 100/100 (A) - Recommended
shell-super-agent: 25/100 (F) - High risk, do not install blindly
```

## CLI 用法

```bash
skill-preflight scan <target>
```

常用参数：

```text
--installed             扫描常见的本地 Skill 安装目录。
--format <format>       输出格式：text、json、markdown、html 或 sarif。默认 text。
--out <file>            将报告写入文件。
--fail-below <score>    如果任意 Skill 分数低于该阈值，则以退出码 1 结束。
--keep-temp             保留临时 GitHub 下载目录，方便调试。
```

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

## GitHub Action

SkillPreflight 已发布到 GitHub Marketplace。Skill 作者可以在每次 PR 或 push 时自动扫描：

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

如果需要 GitHub Code Scanning，可以输出 SARIF：

```bash
skill-preflight scan . --format sarif --out skill-preflight.sarif
```

完整工作流请参考 `docs/github-action.md`。

## 安全原则

SkillPreflight 不会执行被扫描 Skill 里的脚本。

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

## 发布流程

首次 npm 和 GitHub release checklist 请参考 `docs/release.md`。

## 项目地址

- GitHub: https://github.com/agent-contracts/skill-preflight
- npm: https://www.npmjs.com/package/skill-preflight
- GitHub Marketplace: https://github.com/marketplace/actions/skillpreflight
