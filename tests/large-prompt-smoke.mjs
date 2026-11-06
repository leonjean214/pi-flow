import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareTestDist } from "./prepare-dist.mjs";

const file = fileURLToPath(import.meta.url);
const root = dirname(dirname(file));
const large = `BEGIN-GOAL\n${"完整计划与中文交接，不得截断。\n".repeat(6000)}## Handoff\nEND-HANDOFF\n`;
const small = "BEGIN-GOAL\n短计划\n## Handoff\nEND-HANDOFF\n";

if (process.argv[2] === "--probe") {
	await probe(process.argv[3], process.argv[4], process.argv[5]);
} else {
	const out = mkdtempSync(join(tmpdir(), "pi-flow-large-prompt-"));
	try {
		symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
		prepareTestDist(root, join(out, "dist"));
		writeFileSync(join(out, "fake-pi.mjs"), fakePiSource(), { mode: 0o755 });
		writeFileSync(
			join(out, "config.json"),
			JSON.stringify({
				background: { command: join(out, "fake-pi.mjs"), extensions: [] },
			}),
		);
		assert(Buffer.byteLength(large) >= 204800);
		console.log(
			JSON.stringify({
				payloadBytes: Buffer.byteLength(large),
				maxInheritedEnvBytes: Math.max(
					...Object.entries(process.env).map(([key, value]) =>
						Buffer.byteLength(`${key}=${value}`),
					),
				),
			}),
		);
		const failures = [];
		for (const entry of ["pi", "review", "worker"]) {
			for (const size of ["large", "small"]) {
				const result = await new Promise((resolve) =>
					execFile(
						process.execPath,
						[file, "--probe", out, entry, size],
						{ timeout: 20000 },
						(error, stdout, stderr) => resolve({ error, stdout, stderr }),
					),
				);
				console.log(`${entry}/${size}: ${result.error ? "FAIL" : "PASS"}`);
				if (result.stdout) console.log(result.stdout.trim());
				if (result.error) {
					console.error(result.stderr || result.error.message);
					failures.push(`${entry}/${size}`);
				}
			}
		}
		assert.deepEqual(failures, [], "prompt transport failed");
		await lifecycleScenarios(out);
		console.log("large prompt smoke ok");
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
}

async function probe(out, entry, size) {
	const prompt = size === "large" ? large : small;
	const load = (name) => import(pathToFileURL(join(out, "dist", name)).href);
	const config = {
		command: join(out, "fake-pi.mjs"),
		model: "test/model",
		thinking: "off",
		tools: ["read"],
		excludeTools: ["write", "edit"],
		extensions: [],
		timeoutMs: 10000,
		openaiFast: false,
	};
	let summary;
	if (entry === "worker") {
		const { spawnWorker } = await load("flow/parallel/spawner.js");
		const events = [];
		const handle = spawnWorker({
			flowId: "F1",
			goalIndex: 0,
			flowDir: join(out, ".flow/F1"),
			parallelRunId: "test-run",
			cwd: out,
			initialPrompt: prompt,
			sessionFile: join(out, "session.jsonl"),
		});
		// The old implementation can throw E2BIG from the control listener.
		process.once("uncaughtException", (error) => {
			handle.kill();
			console.error(error);
			process.exitCode = 1;
		});
		handle.onEvent((event) => events.push(event));
		const exit = await new Promise((resolve) =>
			handle.onExit((code, signal, stderr) =>
				resolve({ code, signal, stderr }),
			),
		);
		assert.equal(exit.code, 0, JSON.stringify(exit));
		summary = events.find((event) => event.type === "transport").summary;
		assert(summary.args.includes("--session"));
		assert.equal(summary.workerInitialPrompt, "1");
	} else if (entry === "pi") {
		const { runPiPrompt } = await load("shared/pi-process.js");
		const result = await runPiPrompt(config, prompt, out);
		assert(result.ok, JSON.stringify(result));
		summary = JSON.parse(result.text);
	} else {
		const { runReviewProcessResult } = await load("shared/review-process.js");
		const result = await runReviewProcessResult(config, prompt, out);
		assert.equal(result.kind, "output", JSON.stringify(result));
		assert(!result.text.includes("failed"), result.text);
		summary = JSON.parse(result.text);
	}
	assert.equal(summary.bytes, Buffer.byteLength(prompt));
	assert.equal(
		summary.sha256,
		createHash("sha256").update(prompt).digest("hex"),
	);
	assert(summary.tail.includes("END-HANDOFF"));
	assert.equal(summary.payloadInArgv, false);
	assert.equal(summary.payloadInEnv, false);
	assert.equal(summary.args.at(-1), "-p");
	console.log(
		JSON.stringify({
			entry,
			bytes: summary.bytes,
			sha256: summary.sha256,
			maxArgBytes: summary.maxArgBytes,
			eof: true,
		}),
	);
}

async function lifecycleScenarios(out) {
	const { runSpawnProcess } = await import(
		pathToFileURL(join(out, "dist/shared/spawn-runner.js")).href
	);
	const script = (name, content) => {
		const path = join(out, `${name}.mjs`);
		writeFileSync(path, content);
		return path;
	};
	const options = {
		command: process.execPath,
		cwd: out,
		timeoutMs: 10000,
		stdin: large,
	};
	const echo = script(
		"echo",
		'process.stdin.setEncoding("utf8");let text="";for await(const chunk of process.stdin)text+=chunk;process.stdout.write(text);',
	);
	const echoed = await runSpawnProcess({ ...options, args: [echo] });
	assert.equal(echoed.kind, "close");
	assert.equal(echoed.stdout, large);
	const early = script("early", "process.exit(0);");
	const exited = await runSpawnProcess({ ...options, args: [early] });
	assert(["close", "error"].includes(exited.kind), JSON.stringify(exited));
	if (exited.kind === "error") assert.equal(exited.error.code, "EPIPE");
	const missing = await runSpawnProcess({
		...options,
		command: join(out, "missing"),
		args: [],
	});
	assert.equal(missing.kind, "error");
	assert.equal(missing.error.code, "ENOENT");
	const hang = script(
		"hang",
		'process.stdin.resume();process.stdout.write("ready\\n");setInterval(()=>{},1000);',
	);
	assert.equal(
		(await runSpawnProcess({ ...options, args: [hang], timeoutMs: 100 })).kind,
		"timeout",
	);
	const controller = new AbortController();
	const aborted = await runSpawnProcess({
		...options,
		args: [hang],
		signal: controller.signal,
		onLine: () => controller.abort(),
	});
	assert.equal(aborted.kind, "aborted");
	const closed = script(
		"closed",
		'import {closeSync} from "node:fs";closeSync(0);setInterval(()=>{},1000);',
	);
	const broken = await runSpawnProcess({ ...options, args: [closed] });
	assert.equal(broken.kind, "error", JSON.stringify(broken));
	assert.equal(broken.error.code, "EPIPE");
	console.log(
		"stdin lifecycle: echo, early exit, ENOENT, timeout, abort, EPIPE passed",
	);
	const stalled = script(
		"stalled-input",
		'process.stdout.write("ready\\n");setInterval(()=>{},1000);',
	);
	const cleanup = script(
		"timeout-cleanup",
		'import {closeSync} from "node:fs";process.on("SIGTERM",()=>{closeSync(0);setTimeout(()=>{process.stdout.write("cleanup done\\n");process.exit(0);},300);});process.stdout.write("ready\\n");setInterval(()=>{},1000);',
	);
	const timedOutInputs = [];
	for (const [name, path] of [
		["stalled", stalled],
		["cleanup", cleanup],
	]) {
		for (const stdin of [undefined, large]) {
			const result = await runSpawnProcess({
				...options,
				args: [path],
				stdin,
				timeoutMs: 1000,
			});
			console.log(
				JSON.stringify({
					test: `timeout-${name}`,
					bytes: Buffer.byteLength(stdin ?? ""),
					kind: result.kind,
					code: result.kind === "error" ? result.error.code : undefined,
					ready: result.stdout.includes("ready"),
					cleanup: result.stdout.includes("cleanup done"),
				}),
			);
			timedOutInputs.push({ name, result });
		}
	}
	for (const { name, result } of timedOutInputs) {
		assert(result.stdout.includes("ready"), "timeout fixture did not start");
		assert.equal(result.kind, "timeout", JSON.stringify(result));
		if (name === "cleanup")
			assert(
				result.stdout.includes("cleanup done"),
				"SIGTERM cleanup was interrupted",
			);
	}
	console.log("blocked stdin timeout and graceful cleanup passed");
}

function fakePiSource() {
	return `#!/usr/bin/env node
import { createHash } from "node:crypto";
import { connect } from "node:net";
const args = process.argv.slice(2);
process.stdin.setEncoding("utf8");
let input = "";
for await (const chunk of process.stdin) input += chunk;
const prompt = input || args[args.indexOf("-p") + 1] || "";
const summary = {
 bytes: Buffer.byteLength(prompt), sha256: createHash("sha256").update(prompt).digest("hex"),
 tail: prompt.slice(-40), args, maxArgBytes: Math.max(...args.map((arg)=>Buffer.byteLength(arg))),
 payloadInArgv: args.some((arg)=>arg.includes("BEGIN-GOAL")),
 payloadInEnv: Object.values(process.env).some((value)=>value.includes("BEGIN-GOAL")),
 workerInitialPrompt: process.env.PI_FLOW_WORKER_INITIAL_PROMPT,
};
if (process.env.PI_FLOW_WORKER_SOCKET_PATH) {
 const socket = connect(process.env.PI_FLOW_WORKER_SOCKET_PATH, () => socket.write(JSON.stringify({type:"hello",token:process.env.PI_FLOW_WORKER_TOKEN})+"\\n"));
 socket.once("data", () => { console.log(JSON.stringify({type:"transport",summary})); socket.end(); });
} else {
 console.log(JSON.stringify({type:"message_end",message:{role:"assistant",content:[{type:"text",text:JSON.stringify(summary)}]}}));
}
`;
}
