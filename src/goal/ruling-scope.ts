import type { Language } from "../shared/config.js";
import {
	forEachChild,
	parse,
	type SyntaxNode,
	type Word,
} from "./vendor/bash-syntax.js";

type RulingScope = { ruling: string };

function rulingTime(line: string, year: number) {
	const match =
		/(?:(\d{4})-)?(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d)([0-9x])/.exec(line);
	if (!match) return -1;
	const [, y, month, day, hour, tens, units] = match;
	return [
		y ?? year,
		month,
		day,
		hour,
		tens + units.replace("x", "0"),
	].reduce<number>((time, part) => time * 100 + Number(part), 0);
}

export function rulingScope(markdown: string): RulingScope | undefined {
	const lines = markdown.split(/(?<=\n)/);
	const year = new Date().getFullYear();
	let latest: RulingScope | undefined;
	let latestTime = -1;
	let closedMarker = false;
	let fence: string | undefined;
	let heading: { index: number; time: number } | undefined;
	let latestIndex = -1;
	const consider = (ruling: string, time: number, index: number) => {
		if (time > latestTime || (time === latestTime && index > latestIndex)) {
			latestIndex = index;
			latest = { ruling };
			latestTime = time;
		}
	};
	for (const [index, line] of lines.entries()) {
		const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (fence) {
			if (delimiter?.startsWith(fence)) fence = undefined;
			continue;
		}
		if (delimiter) {
			fence = delimiter;
			continue;
		}
		if (/^## /.test(line)) {
			if (heading)
				consider(
					lines.slice(heading.index, index).join("").trimEnd(),
					heading.time,
					heading.index,
				);
			heading = /^## .*(?:裁定|结单)/.test(line)
				? { index, time: rulingTime(line, year) }
				: undefined;
		}
		if (/^- (?:主窗口|监工|任务窗口)[^：:\r\n]*裁定[（(]/.test(line))
			consider(line.trimEnd(), rulingTime(line, year), index);
		if (line.replace(/`+[^`]*`+/g, "").includes("<!-- flow-closed -->"))
			closedMarker = true;
	}
	if (heading)
		consider(
			lines.slice(heading.index).join("").trimEnd(),
			heading.time,
			heading.index,
		);
	// copy-lint-ignore: fixed model-only ruling protocol; not a UI label.
	if (closedMarker) return latest ?? { ruling: "Goal 文件含 flow-closed 标记" };
	return latest && /结单|只(?:做|作)?簿记/.test(latest.ruling)
		? latest
		: undefined;
}

export function rulingScopeNotice(language: Language) {
	return language === "en"
		? "This round may only update records; do not change code, commit, or push."
		: "本轮只更新记录，不得改代码、不得提交推送。";
}

export function withRulingScope(
	prompt: string,
	scope: RulingScope | undefined,
	language: Language,
) {
	if (!scope) return prompt;
	const prefix =
		language === "en"
			? `Authorization scope: the latest ruling closes this step (bookkeeping only). ${rulingScopeNotice(language)} Ruling text:`
			: `授权范围：本步骤最新裁定为结单/只做簿记。${rulingScopeNotice(language)}裁定原文：`;
	return `${prefix}\n${scope.ruling}\n\n${prompt}`;
}

const gitOptionsWithValue = new Set([
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--config-env",
	"--super-prefix",
	"--attr-source",
]);

const gitSwitches = new Set([
	"-p",
	"-P",
	"--paginate",
	"--no-pager",
	"--bare",
	"--no-replace-objects",
	"--no-lazy-fetch",
	"--no-optional-locks",
	"--no-advice",
	"--literal-pathspecs",
	"--glob-pathspecs",
	"--noglob-pathspecs",
	"--icase-pathspecs",
]);

const shellWrappers = new Set([
	"command",
	"env",
	"exec",
	"nohup",
	"time",
	"sudo",
]);
const wrapperOptionsWithValue: Readonly<Record<string, readonly string[]>> = {
	command: [],
	env: ["-u", "--unset", "-C", "--chdir"],
	exec: ["-a"],
	nohup: [],
	time: [],
	sudo: ["-u", "--user", "-g", "--group"],
};
const wrapperSwitches: Readonly<Record<string, readonly string[]>> = {
	command: ["-p"],
	env: ["-i", "--ignore-environment"],
	exec: ["-c", "-l"],
	nohup: [],
	time: ["-p"],
	sudo: ["-n", "--non-interactive", "-H", "-E", "--preserve-env"],
};

function literalWord(word: Word): string | undefined {
	if (
		word.parts?.some((part) => {
			switch (part.type) {
				case "Literal":
				case "SingleQuoted":
				case "AnsiCQuoted":
					return false;
				case "DoubleQuoted":
					return part.parts.some((child) => child.type !== "Literal");
				default:
					return true;
			}
		})
	)
		return undefined;
	return word.value;
}

function isDirectPush(node: Extract<SyntaxNode, { type: "Command" }>) {
	if (!node.name) return false;
	const commandName = (word: string) => word.split("/").at(-1) ?? "";
	let name = commandName(literalWord(node.name) ?? "");
	let skipValue = false;
	// Prefix assignments and redirects are not arguments. Their substitutions
	// are still visited by the AST walk, as are substitutions in the arguments.
	for (const arg of node.args) {
		if (skipValue) {
			skipValue = false;
			continue;
		}
		if (
			shellWrappers.has(name) &&
			(arg.type === "Assignment" ||
				/^[A-Za-z_][A-Za-z_0-9]*\+?=/.test(arg.value))
		)
			continue;
		const word = arg.type === "Word" ? literalWord(arg) : undefined;
		if (word === undefined) return false;
		const [option] = word.split("=", 1);
		if (shellWrappers.has(name)) {
			if (word.startsWith("-")) {
				if (wrapperOptionsWithValue[name].includes(option))
					skipValue = option === word;
				else if (word !== "--" && !wrapperSwitches[name].includes(word))
					return false;
			} else {
				name = commandName(word);
			}
		} else if (name === "git") {
			if (word === "push") return true;
			if (gitOptionsWithValue.has(option)) skipValue = option === word;
			else if (!word.startsWith("--exec-path=") && !gitSwitches.has(word))
				return false;
		} else return false;
	}
	return false;
}

// Inspect parsed command nodes only; never run the script or reparse data as code.
export function isGitPushCommand(command: string): boolean {
	let found = false;
	const visit = (node: SyntaxNode) => {
		if (found) return;
		if (node.type === "Command" && isDirectPush(node)) found = true;
		else forEachChild(node, visit);
	};
	visit(parse(command));
	return found;
}
