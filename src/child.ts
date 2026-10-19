import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerOpenAIFast } from "./shared/openai-fast.js";

export default function flowChildExtension(pi: ExtensionAPI) {
	registerOpenAIFast(pi);
	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		try {
			const message = event.message;
			const now = new Date();
			const directory =
				process.env.PI_USAGE_LEDGER_DIR ??
				join(homedir(), ".pi", "agent", "usage-ledger");
			const line = `${JSON.stringify({
				ts: now.toISOString(),
				pid: process.pid,
				ppid: process.ppid,
				provider: message.provider,
				model: message.model,
				responseId: message.responseId ?? null,
				usage: {
					input: message.usage.input,
					output: message.usage.output,
					cacheRead: message.usage.cacheRead,
					cacheWrite: message.usage.cacheWrite,
					totalTokens: message.usage.totalTokens,
					costTotal: message.usage.cost?.total ?? null,
				},
				session: ctx.sessionManager.getSessionFile() ?? null,
				cwd: ctx.cwd,
				role: process.env.PI_USAGE_ROLE ?? null,
				parent: process.env.PI_USAGE_PARENT ?? null,
			})}\n`;
			if (Buffer.byteLength(line) >= 4096) return;
			mkdirSync(directory, { recursive: true });
			appendFileSync(
				join(
					directory,
					`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}.jsonl`,
				),
				line,
			);
		} catch {
			// Accounting must never interrupt the child agent.
		}
	});
}
