import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareTestDist } from "./prepare-dist.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = mkdtempSync(join(tmpdir(), "pi-flow-usage-ledger-"));
const dist = join(out, "dist");
prepareTestDist(root, dist);
const savedEnv = { ...process.env };
const originalSpawn = childProcess.spawn;
try {
	const { default: childExtension } = await import(
		pathToFileURL(join(dist, "child.js"))
	);
	const handlers = new Map();
	childExtension({
		registerFlag() {},
		on: (name, handler) => handlers.set(name, handler),
	});
	assert.equal(
		typeof handlers.get("message_end"),
		"function",
		"child must record finalized messages",
	);
	process.env.PI_USAGE_LEDGER_DIR = join(out, "ledger");
	process.env.PI_USAGE_ROLE = "reviewer";
	process.env.PI_USAGE_PARENT = "/parent/session.jsonl";
	const date = new Date();
	const path = join(
		process.env.PI_USAGE_LEDGER_DIR,
		`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}.jsonl`,
	);
	const ctx = {
		cwd: root,
		sessionManager: { getSessionFile: () => undefined },
	};
	const message = {
		role: "assistant",
		provider: "openai-codex",
		model: "gpt-6-luna",
		responseId: "resp-test",
		usage: {
			input: 11,
			output: 7,
			cacheRead: 3,
			cacheWrite: 2,
			totalTokens: 23,
			cost: { total: 0.12 },
		},
	};
	const end = handlers.get("message_end");
	end({ message: { role: "user" } }, ctx);
	assert.equal(existsSync(path), false);
	end({ message }, ctx);
	const lines = readFileSync(path, "utf8").trim().split("\n");
	assert.equal(lines.length, 1);
	assert(Buffer.byteLength(`${lines[0]}\n`) < 4096);
	const row = JSON.parse(lines[0]);
	assert.deepEqual(row, {
		ts: row.ts,
		pid: process.pid,
		ppid: process.ppid,
		provider: message.provider,
		model: message.model,
		responseId: message.responseId,
		usage: {
			input: 11,
			output: 7,
			cacheRead: 3,
			cacheWrite: 2,
			totalTokens: 23,
			costTotal: 0.12,
		},
		session: null,
		cwd: root,
		role: "reviewer",
		parent: "/parent/session.jsonl",
	});
	assert(Number.isFinite(Date.parse(row.ts)));
	delete process.env.PI_USAGE_ROLE;
	delete process.env.PI_USAGE_PARENT;
	end(
		{
			message: {
				...message,
				responseId: undefined,
				usage: { ...message.usage, cost: undefined },
			},
		},
		{
			...ctx,
			sessionManager: { getSessionFile: () => "/child/session.jsonl" },
		},
	);
	const second = JSON.parse(readFileSync(path, "utf8").trim().split("\n")[1]);
	assert.equal(second.responseId, null);
	assert.equal(second.usage.costTotal, null);
	assert.equal(second.session, "/child/session.jsonl");
	assert.equal(second.role, null);
	assert.equal(second.parent, null);
	writeFileSync(join(out, "not-a-directory"), "x");
	process.env.PI_USAGE_LEDGER_DIR = join(out, "not-a-directory", "ledger");
	assert.doesNotThrow(() => end({ message }, ctx));
	process.env.PI_USAGE_LEDGER_DIR = join(out, "oversized");
	assert.doesNotThrow(() =>
		end({ message: { ...message, responseId: "x".repeat(5000) } }, ctx),
	);
	assert.equal(
		existsSync(
			join(
				out,
				"oversized",
				`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}.jsonl`,
			),
		),
		false,
	);

	const spawned = [];
	childProcess.spawn = (command, args, options) => {
		spawned.push({ command, args, options });
		const child = new EventEmitter();
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		child.stdout.setEncoding = () => child.stdout;
		child.stderr.setEncoding = () => child.stderr;
		queueMicrotask(() => {
			child.stdout.emit(
				"data",
				`${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } })}\n`,
			);
			child.emit("close", 0, null);
		});
		return child;
	};
	syncBuiltinESMExports();
	const { runPiPrompt } = await import(
		pathToFileURL(join(dist, "shared/pi-process.js"))
	);
	const { runReviewProcessResult } = await import(
		pathToFileURL(join(dist, "shared/review-process.js"))
	);
	const config = {
		command: "pi",
		model: "openai-codex/gpt-6-luna",
		thinking: "low",
		tools: [],
		excludeTools: [],
		extensions: [],
		timeoutMs: 1000,
	};
	await runPiPrompt(config, "ok", root);
	await runPiPrompt(config, "ok", root, undefined, undefined, {
		role: "advisor",
		parent: "/advisor-parent.jsonl",
	});
	await runPiPrompt(config, "ok", root, undefined, undefined, {
		role: "auditor",
		parent: "/audit-parent.jsonl",
	});
	await runReviewProcessResult(
		config,
		"ok",
		root,
		undefined,
		undefined,
		"/review-parent.jsonl",
	);
	await runReviewProcessResult(config, "ok", root);
	assert.deepEqual(
		spawned.map(({ options }) => [
			options.env.PI_USAGE_ROLE,
			options.env.PI_USAGE_PARENT,
		]),
		[
			["executor", String(process.pid)],
			["advisor", "/advisor-parent.jsonl"],
			["auditor", "/audit-parent.jsonl"],
			["reviewer", "/review-parent.jsonl"],
			["reviewer", String(process.pid)],
		],
	);
	for (const { args, options } of spawned) {
		assert(args.includes("--no-session"));
		assert(args.some((arg) => arg.endsWith("child.js")));
		assert.equal(
			options.env.PI_USAGE_LEDGER_DIR,
			process.env.PI_USAGE_LEDGER_DIR,
		);
	}
	process.env.PI_FLOW_ROLES = join(out, "mixed-roles.json");
	const mixedModels = [
		"openai-codex/gpt-6-astra",
		"claude-bridge/claude-sonnet-5-5",
	];
	for (const model of mixedModels)
		await runReviewProcessResult({ ...config, model }, "ok", root);
	for (const [index, { args, options }] of spawned.slice(-2).entries()) {
		assert.equal(args[args.indexOf("--model") + 1], mixedModels[index]);
		assert.equal(options.env.PI_USAGE_ROLE, "reviewer");
		assert.equal(options.env.PI_FLOW_ROLES, process.env.PI_FLOW_ROLES);
	}
	console.log("usage ledger smoke ok");
} finally {
	childProcess.spawn = originalSpawn;
	syncBuiltinESMExports();
	for (const key of [
		"PI_USAGE_LEDGER_DIR",
		"PI_USAGE_ROLE",
		"PI_USAGE_PARENT",
		"PI_FLOW_ROLES",
	]) {
		if (savedEnv[key] === undefined) delete process.env[key];
		else process.env[key] = savedEnv[key];
	}
	rmSync(out, { recursive: true, force: true });
}
