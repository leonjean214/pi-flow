# flow-hybrid（进行中）

## 假设
- 外部计划用现有 Goal markdown 合同；每个一级标题 `# 标题` 开始一个顺序执行的 Goal（1–10 个），二级标题沿用 Objective/Scope/Steps/Success Criteria/Verification/Notes/Handoff。不推测普通自然语言任务单的结构。
- `/flow --plan <path>` 直接校验、提交 draft 并执行，不调用生成/对齐/prewalk 模型；原文件只读。
- `PI_FLOW_ROLES` 指向直接包含 advisor/executor/reviewers 的 JSON 对象，作为本进程完整角色覆盖，子进程继承环境；恢复必须传同一配置。不修改全局配置，也不新增 canonical schema 字段。
- 此单为新增功能，现有 .ai 交接不是本任务要求；bin 的旧 TASK/REVIEW 属于归档脚本，保持不动。

## 验证
待执行。
