import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareTestDist } from "./prepare-dist.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = mkdtempSync(join(tmpdir(), "external-plan-"));
try {
	symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
	const dist = join(out, "dist");
	prepareTestDist(root, dist);
	const { importExternalPlan, parseExternalPlan } = await import(
		pathToFileURL(join(dist, "flow/external-plan.js"))
	);
	const { readFlowConfig } = await import(
		pathToFileURL(join(dist, "shared/config.js"))
	);
	const cwd = join(out, "work");
	mkdirSync(cwd);
	const goal = (title) =>
		`# ${title}\n## Objective\nAdd a file.\n## Scope\nOnly demo.txt.\n## Steps\n- [ ] Write demo.txt\n## Success Criteria\nFile exists.\n## Verification\n- [ ] Read demo.txt\n`;
	const plan = join(cwd, "plan.md");
	const text = goal("Create") + "\n" + goal("Update");
	writeFileSync(plan, text);
	const flow = importExternalPlan(cwd, plan, "en");
	assert.equal(flow.status, "draft");
	assert.equal(flow.goals.length, 2);
	assert.equal(flow.meta.plannedBy, null);
	assert.equal(readFileSync(plan, "utf8"), text);
	assert.equal(flow.source.text, text);
	assert.match(readFileSync(join(cwd, ".flow/F1/G2.md"), "utf8"), /# Update/u);
	assert.throws(() => parseExternalPlan("# Bad\n## Objective\nOops"), /Steps/u);
	assert.throws(() => parseExternalPlan("not a plan"), /# Title/u);
	assert.equal(
		readFileSync(join(cwd, ".flow/F1/flow.json"), "utf8").includes(
			"generating",
		),
		false,
	);

	const configPath = join(out, "config.json");
	const original = JSON.stringify({ modelRoles: { executor: "current" } });
	writeFileSync(configPath, original);
	const rolesPath = join(out, "roles.json");
	const roles = {
		executor: { model: "openai-codex/sol", thinking: "high" },
		advisor: "current",
		reviewers: [
			{ model: "openai-codex/astra", thinking: "high" },
			{ model: "claude-bridge/sonnet", thinking: "medium" },
		],
	};
	writeFileSync(rolesPath, JSON.stringify(roles));
	process.env.PI_FLOW_ROLES = rolesPath;
	const selected = readFlowConfig().modelRoles;
	assert.deepEqual(selected.executor, roles.executor);
	assert.deepEqual(
		selected.reviewers.map(({ model, thinking }) => ({ model, thinking })),
		roles.reviewers,
	);
	assert.equal(readFileSync(configPath, "utf8"), original);
	delete process.env.PI_FLOW_ROLES;
	assert.equal(readFlowConfig().modelRoles.executor, "current");
	writeFileSync(rolesPath, "{}");
	process.env.PI_FLOW_ROLES = rolesPath;
	assert.throws(() => readFlowConfig(), /PI_FLOW_ROLES.*missing advisor/u);
	console.log("external-plan smoke passed");
} finally {
	delete process.env.PI_FLOW_ROLES;
	rmSync(out, { recursive: true, force: true });
}
