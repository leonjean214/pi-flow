# pi-flow usage ledger

## 状态
实现已完成并推送；PR：https://github.com/leonjean214/pi-flow/pull/1
- head：`feat/usage-ledger`
- base：`feature/report-language-toggle`
- 未合并，未改动线上 `~/pi-flow` 工作区。

## 假设
- 严格沿用 `~/claude-tasks/tasks/tools/pi-usage-ledger.md` 的账本格式，不依赖全局扩展。
- 实际角色：质检 `reviewer`、验收 `auditor`、顾问 `advisor`；通用执行入口默认 `executor`。父会话从调用上下文传入，缺失时使用当前进程 PID（即子进程的父 PID），不继承上一层的 attribution。
- worker 通常在宿主 session dir 下，但自定义 session dir / cwd fallback 不保证在默认目录；为避免漏记，worker 显式加载 child 扩展并标记 `worker`。
- `dist/` 已被 git 忽略，构建验证并复制回本 worktree，但不提交产物。

## 改动摘要及文件
- `src/child.ts`：在 `message_end` 过滤 assistant，写本地月份 JSONL。路径默认为 `~/.pi/agent/usage-ledger/YYYY-MM.jsonl`，支持 `PI_USAGE_LEDGER_DIR`。字段严格按契约，缺失 responseId/session/role/parent/costTotal 使用 null；一条记录只调用一次 appendFileSync，记录（含换行）达到 4 KiB 则放弃，所有记账异常吞掉。
- `src/shared/spawn-runner.ts`：透传可选 env。
- `src/shared/pi-process.ts`、`src/shared/review-process.ts`：继承环境并设置本次调用的 `PI_USAGE_ROLE` / `PI_USAGE_PARENT`，不在父进程 JSON 流解析处写账本。
- `src/goal/advisor.ts`、`src/auditor.ts`、`src/review.ts`：传真实角色及当前父会话文件。
- `src/flow/parallel/spawner.ts`、`src/flow/parallel/batch-runner.ts`：worker 加载 child 扩展，设置 worker 角色及控制台父会话。
- `tests/usage-ledger-smoke.mjs`：新测试覆盖字段、每消息一行、非 assistant 不记、nullable 字段、目录写失败、超长记录不写、executor/advisor/auditor/reviewer 环境及父 PID fallback；mock 原生 spawn，检查真正传给子进程的 env。
- `tests/flow-smoke.mjs`：原 worker 集成场景增加 child 扩展、worker 角色和父会话断言。
- `package.json`：将新 smoke 纳入现有 npm test。

## parallel worker 会话路径结论
`src/flow/parallel/batch-runner.ts` 的 `workerSessionPath()`：优先复用 artifact/goal session，或 prewalk 分支；新会话使用 `ctx.sessionManager.getSessionDir()`，没有则退回 `ctx.cwd`，文件名为 Flow/Goal 会话名 + `.jsonl`。因此默认是 Pi 的 cwd-specific session dir（通常在 `~/.pi/agent/sessions` 下），但不是硬编码保证。prewalk 分支也沿用宿主会话目录。此次 worker 无论路径都加载 child 扩展，避免依赖全局扫描目录；父进程不重复记账。

## 验证命令与结果
### Red → Green（Win）
1. 只加入测试、尚未实现 handler 时，Win 的新 smoke 失败：`AssertionError: child must record finalized messages`，actual `undefined` / expected `function`。
2. 实现后：
   `WIN_GATE_SCRIPT=pi-flow-ledger-gate.ps1 GATE_UNIT=tests/usage-ledger-smoke.mjs win-gate "$PWD" pi-flow-ledger 3197 quick`
   TypeScript 编译通过，`usage ledger smoke ok`，`QUICK PASSED`。
   日志：`/tmp/pi-flow-ledger-red.log`、`/tmp/pi-flow-ledger-green.log`。

### 构建 / 静态检查（Win）
`WIN_GATE_SCRIPT=pi-flow-ledger-gate.ps1 win-gate "$PWD" pi-flow-ledger 3197 all`
- `npm run check`：Biome（205 files）、tsc --noEmit、`npm run build` 均通过。
- `npm test` 的 pretest 再构建通过，随后执行测试。
- 原生 Windows 无法直接启动项目现有的 `node_modules/.bin/tailwindcss`（Unix 风格入口）。只在 Win 验证目录外放置 `NODE_OPTIONS=--import file:///C:/Users/game5090/mac-offload/pi-flow-win-tools.mjs`，将该启动转为 `node node_modules/tailwindcss/lib/cli.js`；未修改仓库构建代码。
- 完整构建的 dist 已从 Win 复制回本 worktree，仍被 git 忽略。
- 日志：`/tmp/pi-flow-ledger-all.log`。

### 全部 smoke 条目的跨平台结果
现有 npm test 列表共 24 项（含本次新增），逐项覆盖：23 通过，1 项按原逻辑跳过。
- Win 通过 16 项：usage-ledger、agent-progress、monitor-overlay、language、report-language、plan、scheduler、prewalk、prewalk-flow-eval、context-evidence、context-evidence-evaluation、activity-frame、status、result-card、model-roles、report-curve。
- Win footer smoke 按原逻辑跳过：本 worktree 的 `../footer.ts` 不存在。
- 原生 Win 的完整 npm test 在 goal-review 的 shell fixture 处失败（不能启动现有 `#!/bin/sh` 测试命令）；后续单独执行还确认 report-server 的 Windows rename EPERM、package 的 spawnSync npm ENOENT、copy-lint 的反斜杠 allowlist 差异。
- 按任务单允许的「Mac 单个测试文件 + nice -n 15」，对 POSIX 依赖的 7 项逐个补测，全部通过；未在 Mac 跑构建或一次性全套 npm test：
  `nice -n 15 env npm_lifecycle_event=test node tests/<name>-smoke.mjs`
  name 分别为 `goal-review`、`review`、`flow`、`openai-fast`、`report-server`、`package`、`copy-lint`。这里直接复用 Win 预编译 dist，不触发 Mac 编译；flow smoke 含新增 worker spawn 集成断言。
- 日志：`/tmp/pi-flow-ledger-remaining.log`、`/tmp/pi-flow-ledger-{goal-review,review,flow,openai-fast,report-server,package}.log`；copy-lint 输出 `copy lint smoke ok`。
- 不是声称原生 Windows 上 `npm test` 已经 exit 0；完整条目通过结果是上述两平台合并结果。

### 真实 reviewer 冒烟
本 worktree 被忽略的 `config.json` 配置 reviewer 为 `openai-codex/gpt-6-luna`、`thinking=low`、tools=[]。
运行：`nice -n 15 node /tmp/pi-flow-ledger-live.mjs`。脚本从该 config 读取 reviewer，调用生产 `runReviewProcessResult()`，使用 `PI_USAGE_LEDGER_DIR` 临时目录；检查结果为 ok、只有一条账本行、模型/角色/parent/session 均正确。此单进程小冒烟复用 Mac 已有 Pi 认证，没有手动读凭据或登录。
结果：`LIVE REVIEWER LEDGER PASSED`。
临时账本：`/var/folders/x9/nrst73ps2y7bnfbmlqjtklzh0000gn/T/pi-flow-ledger-live-jZYaTe/2026-10.jsonl`
日志：`/tmp/pi-flow-ledger-live.log`
真实账本原行：
```json
{"ts":"2026-10-19T05:53:39.080Z","pid":65957,"ppid":65955,"provider":"openai-codex","model":"gpt-6-luna","responseId":"resp_0a608c14b6d4a83d016ad5b0619dac8194bb9d68daf9bccd43","usage":{"input":12383,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":12388,"costTotal":0.0012408},"session":null,"cwd":"/Users/leonjean/wt/pi-flow-ledger","role":"reviewer","parent":"65955"}
```

## 已知风险 / 待 Claude 操作
- 账本是 best-effort；不可写目录及超过契约行长度限制的异常元数据会被静默放弃，不影响执行。
- fork 的 Actions API 返回 workflows=0，PR 没有自动 CI；尝试临时验证分支也未触发，已删除该远端分支及临时 worktree，没有改变默认分支或仓库设置。
- 若合并门禁要求「同一 POSIX 环境一次完整 npm test exit 0」而非上述逐项跨平台覆盖，需要 Claude 启用此 fork 的 GitHub Actions 后重跑 CI；这是唯一尚缺的单环境验证。请亲审 PR，按任务授权本执行者不合并。
