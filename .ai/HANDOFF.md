# HANDOFF：整合 fork/main 到在用分支

状态: DONE（待 Claude 部署）

PR: https://github.com/leonjean214/pi-flow/pull/4（base feature/report-language-toggle，未合并）

## 假设
- 冲突取舍选「改动最小、两边功能都保留」。
- 在用 pi 的 report daemon 占着 127.0.0.1:49327（PID 58353，`~/pi-flow/dist/report-daemon.js`），不能杀。需要该固定端口的 4 个 smoke 在本机直接跑会 EADDRINUSE。验证时用**一次性拷贝**把 49327 全部替换成 49399，并用独立 `PI_CODING_AGENT_DIR`，**未提交任何端口改动**。

## 变更摘要
`git merge fork/main`（da3f1d8，6 个提交）进 `integrate/live-with-main`（起点 3129180），merge commit e8c5e53。仅 2 个文件冲突。

### 冲突取舍
1. `package.json` 的 `scripts.test`：取 main 的列表（新增 `graph-flow-eval-smoke`），再补回我方 `external-plan-smoke`、`usage-ledger-smoke`、`report-language-smoke`。理由：两边的 smoke 都要跑；`tests/` 下全部 `*smoke.mjs` 都在列表里（已程序核对）。`eval:graph` 脚本与 main 的 0.81.0 依赖由 git 自动合并，无冲突。
2. `src/flow.ts` import 块：保留我方 `runtimeLanguage`（仍在用），报告 import 取 main 的 `releaseReportStatusContext`，丢掉 `bindLiveReport`。理由：main 把 flow 报告绑定改成统一生命周期后，`flow.ts` 里 `bindLiveReport` 已无调用，留着会被 biome 判未使用。

### 自动合并核对
- `PI_FLOW_ROLES`（`src/shared/config.ts:194`）、外部计划导入（`src/flow/external-plan.ts`）仍在。
- `prompts/{zh,en}/flow-review-severity.md` 存在；`src/auditor.ts`/`src/review.ts` 的分级注入、`src/flow/html.ts`、`batch-runner.ts`、`src/shared/report-directory.ts` 来自 main。
- 对 3129180 的 diff 中被删的行都是 main 重构替换掉的旧代码（独立质检报告刷新、`bindLiveReport`、旧 review 提示拼接）。

## 验证
- 基线（fork/main da3f1d8，临时 worktree，已移除）：`npm ci` 通过；`npm test` 在 `review-smoke` 处断（该 smoke 在 `npm test` 里串联，短路）。逐个跑：除 flow/package/report-server/review 4 个 smoke 因 49327 被占而失败外全过。端口改 49399 + 隔离 `PI_CODING_AGENT_DIR` 后这 4 个全过。本机没复现任务单预期的 `englishCurrentTaskReviewPromptScenario` ENOENT，但它在 GitHub CI（Linux / node 22）里复现，见下。
- 整合分支：`npm ci` exit 0；`npm run check` exit 0；
  - 逐个跑 `tests/*smoke.mjs`：同样只有那 4 个因端口被占失败，与基线一致；
  - 端口改 49399 的拷贝里完整 `npm test` exit 0（18 个 "smoke ok"，footer smoke 因缺 `../footer.ts` 按设计跳过，与基线一致）。
- 冒烟（整合后 `dist/`，临时目录）：无 `PI_FLOW_ROLES` 时 executor=`current`；设置后 executor=`openai-codex/sol`/high，reviewers=astra、sonnet；zh/en 分级提示均含 P0–P3 与「只有 P0/P1 驱动 FAIL」；`tests/goal-review-smoke.mjs` 断言该文本注入真实 reviewer 参数。
- `~/pi-flow` 主 checkout 未触碰。

## 风险 / 待 Claude 操作
- 部署：把 `~/pi-flow` 更新到本分支前，注意在用 daemon 是协议 1、main 是协议 2（`Incompatible pi-flow report protocol 1; expected 2`）：部署后需重启运行中的 pi / report daemon。
- 固定端口的 smoke 在 pi 运行时无法在本机直接跑，CI 或停掉 daemon 后再跑一次更稳。

## CI 状态（PR #4）
- PR 的 `check` 为红：`review smoke failed in englishCurrentTaskReviewPromptScenario`，ENOENT 读 `.flow/reviews/<id>.html`（`tests/review-smoke.mjs:1285` 附近，测试读报告时文件尚未写出，疑似异步竞态）。
- **基线证明**：fork/main 自己的 push CI（run 40216341999，da3f1d8）在同一场景同一 ENOENT 失败；PR #3 的 CI（run 40167071627）同样为红。故非本次合并引入。
- 因 `npm test` 串联短路，CI 里 review-smoke 之后的 smoke 没跑；这些在本机（端口隔离）已全过。
- 本 PR 未修这个竞态（超出「整合」范围）；建议另开小单修复。
