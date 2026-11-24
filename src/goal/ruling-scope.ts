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

// Scan literal simple commands; never execute shell code or expand dynamic names.
export function isGitPushCommand(command: string) {
	let pos = 0;
	let found = false;
	const redirect = /(?:[0-9]+)?(?:<<<|<<-|<<|>>|>&|<&|<>|>\||>|<)|&>>?/y;
	const assignment = /^[A-Za-z_][A-Za-z_0-9]*=/;
	const continued = () => command.startsWith("\\\n", pos);
	const skipBlanks = () => {
		while (pos < command.length) {
			if (continued()) pos += 2;
			else if (/[ \t]/.test(command[pos])) pos++;
			else break;
		}
	};

	function readWord(end: string, literal = false) {
		let word = "";
		let quoted = false;
		let quote = "";
		while (pos < command.length) {
			const ch = command[pos];
			if (!quote && (ch === end || /[\s;&|()<>]/.test(ch))) break;
			if (ch === "\\" && quote !== "'") {
				const next = command[pos + 1];
				if (!next || (quote && !/[\\"$`\n]/.test(next))) {
					word += ch;
					pos++;
					continue;
				}
				if (next !== "\n") {
					quoted = true;
					word += next;
				}
				pos += 2;
			} else if (ch === quote || (!quote && (ch === "'" || ch === '"'))) {
				quoted = true;
				quote = quote ? "" : ch;
				pos++;
			} else if (
				!literal &&
				quote !== "'" &&
				(ch === "`" || command.startsWith("$(", pos))
			) {
				pos += ch === "`" ? 1 : 2;
				scan(ch === "`" ? "`" : ")");
				word += "\0";
			} else {
				word += ch;
				pos++;
			}
		}
		return { word, quoted };
	}

	function scan(end = ""): void {
		const heredocs: { delimiter: string; stripTabs: boolean }[] = [];
		let mode: "start" | "git" | "other" = "start";
		let skipValue = false;
		let wrapper = "";
		while (!found && pos < command.length) {
			skipBlanks();
			if (pos === command.length) break;
			const ch = command[pos];
			if (ch === end) {
				pos++;
				return;
			}
			if (ch === "#") {
				while (pos < command.length && command[pos] !== "\n") pos++;
				continue;
			}
			redirect.lastIndex = pos;
			const op = redirect.exec(command)?.[0];
			if (op) {
				pos += op.length;
				skipBlanks();
				const heredoc = /^\d*<<-?$/.test(op);
				const { word } = readWord(end, heredoc);
				if (heredoc)
					heredocs.push({ delimiter: word, stripTabs: op.endsWith("-") });
				continue;
			}
			if (/[;&|()\n]/.test(ch)) {
				pos++;
				if (ch === "(") scan(")");
				if (ch === "\n") {
					for (const { delimiter, stripTabs } of heredocs.splice(0)) {
						while (pos < command.length) {
							const newline = command.indexOf("\n", pos);
							const line = command.slice(
								pos,
								newline < 0 ? command.length : newline,
							);
							pos = newline < 0 ? command.length : newline + 1;
							if ((stripTabs ? line.replace(/^\t+/, "") : line) === delimiter)
								break;
						}
					}
				}
				mode = "start";
				skipValue = false;
				wrapper = "";
				continue;
			}
			const start = pos;
			const { word, quoted } = readWord(end);
			if (pos === start) {
				pos++;
				continue;
			}
			if (skipValue) {
				skipValue = false;
				continue;
			}
			const [option] = word.split("=", 1);
			if (mode === "start") {
				if (
					(!quoted && shellCommandPrefixes.has(word)) ||
					assignment.test(command.slice(start, pos))
				)
					continue;
				if (wrapper && word.startsWith("-")) {
					if (wrapperOptionsWithValue[wrapper].includes(option))
						skipValue = option === word;
					else if (word !== "--" && !wrapperSwitches[wrapper].includes(word))
						mode = "other";
					continue;
				}
				const name = word.split("/").at(-1) ?? "";
				if (shellWrappers.has(name)) wrapper = name;
				else mode = name === "git" ? "git" : "other";
			} else if (mode === "git") {
				if (word === "push") found = true;
				else if (gitOptionsWithValue.has(option)) skipValue = option === word;
				else if (!gitSwitches.has(word)) mode = "other";
			}
		}
	}

	scan();
	return found;
}
