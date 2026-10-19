import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FLOW_GOAL_SECTIONS, validatePlanMarkdown } from "../plan/validator.js";
import type { Language } from "../shared/config.js";
import { buildFlowArtifact } from "./builder.js";
import { withFlowLockSync } from "./lock.js";
import { reservePreDraftFlow, writeFlow } from "./store.js";
import { validateDraftDir } from "./validator.js";

/** Each H1 starts a sequential Goal; all other content uses the existing plan contract. */
export function parseExternalPlan(markdown: string) {
	const blocks: Array<{ title: string; markdown: string }> = [];
	let fenced = false;
	let fence = "";
	for (const line of markdown.split("\n")) {
		const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
		if (marker && (!fenced || marker[0] === fence)) {
			fenced = !fenced;
			fence = marker[0];
		}
		const title = !fenced && /^#\s+(.+?)\s*$/u.exec(line)?.[1];
		if (title) blocks.push({ title, markdown: `${line}\n` });
		else if (blocks.length) blocks[blocks.length - 1].markdown += `${line}\n`;
		else if (line.trim())
			throw new Error("External plan must start with # Title");
	}
	if (blocks.length < 1 || blocks.length > 10)
		throw new Error("External plan requires 1–10 # Goal headings");
	for (const [index, block] of blocks.entries()) {
		// Builder normally supplies these optional sections. Do the same before validation.
		for (const section of ["Notes", "Handoff"]) {
			if (!new RegExp(`^## ${section}\\s*$`, "mu").test(block.markdown))
				block.markdown += `\n## ${section}\n`;
		}
		const errors = validatePlanMarkdown(block.markdown, FLOW_GOAL_SECTIONS);
		if (errors.length)
			throw new Error(
				`External plan Goal ${index + 1} (${block.title}): ${errors.join("; ")}`,
			);
	}
	return blocks;
}

export function importExternalPlan(
	cwd: string,
	path: string,
	language: Language,
) {
	const absolute = resolve(cwd, path);
	const text = readFileSync(absolute, "utf8");
	const blocks = parseExternalPlan(text);
	const location = reservePreDraftFlow(cwd);
	const result = withFlowLockSync(location.dir, "import external plan", () => {
		try {
			for (const [index, block] of blocks.entries())
				writeFileSync(join(location.dir, `G${index + 1}.md`), block.markdown);
			const flow = buildFlowArtifact(
				location.dir,
				{
					title: blocks[0].title,
					goals: blocks.map((block, index) => ({
						title: block.title,
						role: "normal",
						file: `G${index + 1}.md`,
					})),
				},
				language,
				{ type: "file", path: absolute, text },
			);
			const validated = validateDraftDir(location.dir, language);
			if (!validated.ok) throw new Error(validated.errors.join("; "));
			return writeFlow(location.dir, {
				...flow,
				meta: { plannedBy: null, alignment: null },
			});
		} catch (error) {
			rmSync(location.dir, { recursive: true, force: true });
			throw error;
		}
	});
	if (!result.ok)
		throw new Error(`External plan import lock busy: ${location.id}`);
	return result.value;
}
