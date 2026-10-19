# pi-flow usage ledger

## 假设
- 严格沿用 `~/claude-tasks/tasks/tools/pi-usage-ledger.md` 的账本格式，不依赖全局扩展。
- 实际调用角色：质检 reviewer、验收 auditor、顾问 advisor；通用执行入口默认 executor。父会话从调用上下文传入，缺失时使用当前进程 PID（即子进程的父 PID）。
- worker 通常在宿主 session dir 下，但自定义 session dir / cwd fallback 不保证在默认目录；为避免漏记，worker 显式加载 child 扩展并标记 worker。
- `dist/` 已被 git 忽略，构建验证但不提交产物。不动线上 `~/pi-flow`。

## 验证
待执行。
