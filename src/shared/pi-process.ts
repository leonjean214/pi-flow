import { collectAssistantEvents } from "./assistant-event-stream.js";
import { childExtensionArgs } from "./child-extensions.js";
import type { ReviewerConfig, RoleModelSelection } from "./config.js";
import { isContextWindow } from "./context-evidence.js";
import { isRecord } from "./guards.js";
import { openaiFastArgs } from "./openai-fast.js";
import { runSpawnProcess, type SpawnRunnerResult } from "./spawn-runner.js";

type ModelWindowTarget = RoleModelSelection & {
	command: string;
	extensions?: string[];
};

/** Query each target as Pi would select it, without starting an agent turn. */
export async function resolvePiModelWindows(
	targets: readonly ModelWindowTarget[],
	cwd: string,
	signal?: AbortSignal,
): Promise<ReadonlyMap<string, number>> {
	const unique = new Map<string, ModelWindowTarget>();
	for (const target of targets)
		if (!unique.has(target.model)) unique.set(target.model, target);
	const windows = new Map<string, number>();
	const id = "pi-flow-model-window";
	await Promise.all(
		[...unique.values()].map(async (target) => {
			if (signal?.aborted) return;
			const result = await runSpawnProcess({
				command: target.command,
				args: [
					"--mode",
					"rpc",
					"--no-session",
					...(target.extensions ? childExtensionArgs(target.extensions) : []),
					"--model",
					target.model,
					"--thinking",
					target.thinking,
				],
				cwd,
				stdin: `${JSON.stringify({ id, type: "get_state" })}\n`,
				timeoutMs: 30_000,
				signal,
			});
			if (result.kind !== "close" || result.code !== 0) return;
			for (const line of result.stdout.split("\n")) {
				if (!line.startsWith("{")) continue;
				let event: unknown;
				try {
					event = JSON.parse(line);
				} catch {
					// Startup extensions may also write diagnostics to stdout.
					continue;
				}
				if (
					!isRecord(event) ||
					event.id !== id ||
					event.type !== "response" ||
					event.command !== "get_state"
				)
					continue;
				if (
					event.success !== true ||
					!isRecord(event.data) ||
					!isRecord(event.data.model)
				)
					return;
				const { provider, id: modelId, contextWindow } = event.data.model;
				if (
					typeof provider === "string" &&
					typeof modelId === "string" &&
					`${provider}/${modelId}` === target.model &&
					isContextWindow(contextWindow)
				)
					windows.set(target.model, contextWindow);
				return;
			}
		}),
	);
	return windows;
}

export async function runPiPrompt(
	config: ReviewerConfig,
	prompt: string,
	cwd: string,
	signal?: AbortSignal,
	onEvent?: (event: unknown) => void,
) {
	const events = collectAssistantEvents(onEvent);
	const result = await runSpawnProcess({
		command: config.command,
		args: piPromptArgs(config),
		stdin: prompt,
		cwd,
		timeoutMs: config.timeoutMs,
		signal,
		onLine: events.onLine,
	});
	if (result.kind === "aborted")
		return { ok: false as const, feedback: "子进程已取消。" };
	if (result.kind === "timeout")
		return { ok: false as const, feedback: "子进程超时。" };
	if (result.kind === "error")
		return {
			ok: false as const,
			feedback: `子进程启动失败：${result.error.message}`,
		};
	const text = events.text();
	if (result.code === 0)
		return text.trim()
			? { ok: true as const, text }
			: { ok: false as const, feedback: "子进程输出为空。" };
	const output = (result.stderr.trim() || text.trim()).slice(0, 2000);
	return {
		ok: false as const,
		feedback: `${piFailureReason(result)}${output}`,
	};
}

function piFailureReason(
	result: Extract<SpawnRunnerResult, { kind: "close" }>,
) {
	if (result.code !== null) return `子进程失败，退出码 ${result.code}。`;
	return `子进程被信号 ${result.signal ?? "unknown"} 终止。`;
}

export function piPromptArgs(config: ReviewerConfig) {
	return [
		"--no-session",
		"--mode",
		"json",
		...childExtensionArgs(config.extensions),
		"--model",
		config.model,
		"--thinking",
		config.thinking,
		"--tools",
		config.tools.join(","),
		"--exclude-tools",
		config.excludeTools.join(","),
		...openaiFastArgs(config.openaiFast),
		"-p",
	];
}
