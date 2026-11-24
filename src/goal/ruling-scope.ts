import type { Language } from "../shared/config.js";

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

const shellCommandPrefixes = new Set([
	"!",
	"{",
	"if",
	"then",
	"elif",
	"else",
	"while",
	"until",
	"do",
]);
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

function shellWord(token: string) {
	return token.replace(
		/'([^']*)'|"((?:\\.|[^"\\])*)"|\\(.)/g,
		(_, single, double, escaped) =>
			single ?? double?.replace(/\\(["\\$`])/g, "$1") ?? escaped,
	);
}

// Recognize direct commands separated by shell operators, without running or expanding shell code.
export function isGitPushCommand(command: string) {
	const tokens =
		command.match(
			/#[^\n]*|[;&|()\n<>]|(?:'[^']*'|"(?:\\[\s\S]|[^"\\])*"|\\[^\n]|[^\s;&|()<>"'\\])+/g,
		) ?? [];
	let atCommandStart = true;
	let gitArguments = false;
	let gitOptionValue = false;
	for (const token of tokens) {
		if (/^[;&|()\n]$/.test(token)) {
			atCommandStart = true;
			gitArguments = false;
			gitOptionValue = false;
			continue;
		}
		if (token.startsWith("#")) continue;
		if (atCommandStart) {
			if (
				shellCommandPrefixes.has(token) ||
				/^[a-zA-Z_][a-zA-Z_0-9]*=/.test(token)
			)
				continue;
			gitArguments = shellWord(token) === "git";
			atCommandStart = false;
			continue;
		}
		if (!gitArguments) continue;
		if (gitOptionValue) {
			gitOptionValue = false;
			continue;
		}
		const word = shellWord(token);
		if (word === "push") return true;
		if (gitOptionsWithValue.has(word)) gitOptionValue = true;
		else if (
			!gitSwitches.has(word) &&
			!(word.includes("=") && gitOptionsWithValue.has(word.split("=", 1)[0]))
		)
			gitArguments = false;
	}
	return false;
}
