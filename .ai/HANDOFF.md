# flow-hybrid — A / pi-flow

## 假设
- 外部 markdown 严格沿用现有 Goal 合同，不猜测普通任务单结构。每个 H1 开始一个顺序执行 Goal（1–10 个），无并行/额外 final_acceptance DSL。
- `/flow --plan <path>` 表示直接校验、导入、启动，不问确认、不调用生成/对齐模型，不登记 prewalk 记忆。原文件只读。
- `PI_FLOW_ROLES` 指向完整角色对象，仅影响本进程及子进程；不新增 canonical schema 字段。换进程恢复须重传相同配置。

## 变更
- `src/flow/external-plan.ts`：解析外部计划，预校验章节，在独占预留的 Flow 目录锁内复用 canonical builder/validator 提交；错误不回退生成。
- `src/flow.ts`：新增 `/flow --plan <path>`，支持 JSON 双引号路径（包括空格/转义字符），直接复用 `goFlow`。
- `src/flow/store.ts`：导出现有原子目录预留函数。
- `src/shared/config.ts`：只读 `PI_FLOW_ROLES`，复用角色校验与 provider-neutral reviewer 配置；要求三个角色键齐全。
- `tests/external-plan-smoke.mjs` / `tests/usage-ledger-smoke.mjs`：导入/坏计划/源文件只读/全局配置不变、混 provider reviewer 的实际 spawn 模型和账本角色环境传播。
- `package.json`、双语 README：接入测试、记录格式与接口。

## 给 Claude 的计划格式
每个一级标题就是一个 Goal；不要另写总标题。最小单步如下，再紧接另一组 `# 下一步标题` 和相同章节即可得到两步 Flow。外部文件路径相对于当前 cwd；命令推荐 `/flow --plan "/absolute/path/plan.md"`。

```markdown
# 创建文件
## Objective
创建 hello.txt，内容为 hello 加换行。
## Scope
只改 hello.txt 与本步骤运行态计划。
## Steps
- [ ] 创建 hello.txt。
## Success Criteria
hello.txt 内容准确。
## Verification
- [ ] 用命令核对文件内容。
```

`Notes` / `Handoff` 可省略，导入时补齐；其他上述章节必需。Objective 不得为空。Steps/Verification 各至少一个 checkbox；Objective/Scope/Success Criteria 不得有 checkbox。代码围栏外 H1 只作 Goal 分界。

角色 JSON 是直接的 `{"executor":{"model":"provider/id","thinking":"high"},"advisor":"current","reviewers":[{"model":"provider/id","thinking":"medium"}]}`，不包 `modelRoles`。文件需在整次 Flow 期间保持可读且不变。

## 验证
- Win 原生尝试：现有构建脚本以 Unix `.bin/tailwindcss` 路径 spawn，报 ENOENT；未修改无关平台构建代码。
- `mac-bg ... npm run check`：exit 0。
- `mac-bg` 定向 external-plan / model-roles / usage-ledger / copy-lint smoke：全过。
- 本机 `npm test` 在 review smoke 被线上固定端口 49327 daemon 阻挡；没有停止线上服务。
- 已换免费 Linux CI 验证全量：`npm run check && npm test` 全过，run https://github.com/leonjean214/pi-flow/actions/runs/39243211208 （commit 84e43b5）。

## 真实冒烟（与 B 联调）
命令：`pi-flow-run --cwd /tmp/flow-hybrid-smoke --plan /tmp/flow-hybrid-smoke/plan.md --roles /tmp/flow-hybrid-smoke/roles.json --model openai-codex/gpt-6-luna --timeout 600`。
仅在临时 PATH 注入 launcher，加载本 worktree dist 和已有 usage-ledger；未安装或替换线上插件。所有角色配置为 `openai-codex/gpt-6-luna / low`。
- F1：两 Goal 均 complete；第 1 步创建 hello.txt，第 2 步修改，最终内容准确为 `hello hybrid\n`。
- 计划生成未发生：`meta={plannedBy:null,alignment:null}`，初始即执行外部计划；源计划未改。
- `~/pi-flow/config.json` MD5 前后均为 `1f25f2266e2b7129a189d746b6986b21`。
- 原始账本匹配此 cwd：executor 10、auditor 12、reviewer 12，provider 全为 openai-codex、model 全为 gpt-6-luna。为验证无失败时不会自然触发的 advisor，另做同配置 `runPiPrompt` 顾问路径探针，返回 OK，advisor 2 行；这是单独探针，不声称 Flow 自动触发顾问。原始行数含工具回合及 child/显式 ledger 扩展重复记录，不代表独立模型请求数。
- 坏计划真实 RPC：列出 Goal 1 缺少的 Scope/Steps/Success Criteria/Verification，不创建 F 目录、不调用模型；B 正确处理 Pi 的 `extension_error`，exit 1。
- 日志：`/tmp/flow-hybrid-real-smoke.log`、`/tmp/flow-hybrid-advisor-probe.log`、`/tmp/flow-hybrid-bad-fixed.log`。

## 交付与风险
- A PR：https://github.com/leonjean214/pi-flow/pull/2，base `feature/report-language-toggle`；未合并。
- B 依赖 A；审查合并/上线必须先 A 后 B。没有更改两个主 checkout 的工作文件或本机全局配置。
- 混 provider 的模型参数/角色环境已定向测试；为控制花费，真实模型冒烟按要求全用 Luna，没有额外真调 Claude reviewer。
