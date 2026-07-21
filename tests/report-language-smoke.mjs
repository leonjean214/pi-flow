import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

const dist = new URL("../dist/", import.meta.url);
const { renderFlowHtml, writeFlowErrorHtml } = await import(
	new URL("flow/html.js", dist)
);
const { renderReviewReport } = await import(new URL("review/report.js", dist));
const { renderMarkdownBlock } = await import(
	new URL("shared/html-markdown.js", dist)
);

const cwd = mkdtempSync(join(tmpdir(), "pi-flow-report-language-"));
const flow = {
	schemaVersion: 17,
	language: "zh",
	id: "F1",
	title: "AUTHORED FLOW 标题",
	status: "aligning",
	source: { type: "prompt", text: "AUTHORED /tmp/source --flag" },
	createdAt: Date.now(),
	updatedAt: Date.now(),
	startedAt: null,
	completedAt: null,
	currentGoal: 0,
	meta: null,
	attention: null,
	parallelRun: null,
	repairAttempts: 0,
	errors: [],
	goals: [],
};
const flowHtml = renderFlowHtml(cwd, flow);
const diagnostic = `缺少 flow.json · path=${cwd}/flow.json · command=/flow go F1`;
const errorHtml = readFileSync(
	writeFlowErrorHtml(cwd, {
		title: "AUTHORED VALIDATION TITLE",
		errors: [diagnostic],
		requestText: "AUTHORED VALIDATION REQUEST /tmp/request --raw",
		language: "zh",
	}),
	"utf8",
);
const reviewHtml = renderReviewReport(
	{ active: null, history: [], phase: "awaiting_agent", round: 0 },
	"en",
	{ ok: true, packet: { text: "AUTHORED EVIDENCE /tmp/evidence --raw" } },
);
const markdownAuthored = [
	"AUTHORED DONE /tmp/done /flow go F1",
	"AUTHORED ACTIVE 中文 /tmp/active --flag",
	"AUTHORED BLOCKED /tmp/blocked npm test",
	"AUTHORED TODO /tmp/todo model/name",
];
const markdownHtml = renderMarkdownBlock(
	[
		`- [x] ${markdownAuthored[0]}`,
		`- [~] ${markdownAuthored[1]}`,
		`- [!] ${markdownAuthored[2]}`,
		`- [ ] ${markdownAuthored[3]}`,
	].join("\n"),
	"",
	"en",
);
const emptyMarkdownHtml = renderMarkdownBlock("", "", "en");

for (const [name, html] of [
	["flow", flowHtml],
	["flow validation error", errorHtml],
	["review", reviewHtml],
]) {
	assert(
		html.includes('data-language-option="zh"'),
		`${name}: Chinese control missing`,
	);
	assert(
		html.includes('data-language-option="en"'),
		`${name}: English control missing`,
	);
	assert(html.includes("pi-flow-language"), `${name}: preference key missing`);
	assert(
		html.includes('new EventSource("events")'),
		`${name}: relative SSE changed`,
	);
	assert(!html.includes("https://cdn"), `${name}: external asset introduced`);
	assert.equal(
		(html.match(/<script>/gu) ?? []).length,
		1,
		`${name}: inline script count changed`,
	);
	const inlined = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1] ?? "";
	const hash = createHash("sha256").update(inlined).digest("base64");
	assert(
		html.includes(`script-src 'sha256-${hash}'`),
		`${name}: CSP hash mismatch`,
	);
}
assert(flowHtml.includes("AUTHORED FLOW 标题"));
assert(flowHtml.includes("AUTHORED /tmp/source --flag"));
assert(errorHtml.includes(`<li>${diagnostic}</li>`));
assert(!errorHtml.includes(`data-ui-zh="${diagnostic}"`));
assert(errorHtml.includes("AUTHORED VALIDATION REQUEST /tmp/request --raw"));
assert(reviewHtml.includes("AUTHORED EVIDENCE /tmp/evidence --raw"));
assert(reviewHtml.includes('data-report-default-language="en"'));
assert(reviewHtml.includes('data-report-title-zh="Flow — 独立质检"'));
assert(reviewHtml.includes('data-report-title-en="Flow — Quality review"'));
for (const [zh, en] of [
	["完成", "Done"],
	["进行中", "In progress"],
	["阻塞", "Blocked"],
	["待做", "Todo"],
]) {
	assert(markdownHtml.includes(`data-ui-zh="${zh}" data-ui-en="${en}"`));
	assert(markdownHtml.includes(`>${en}</span>`));
}
assert(
	emptyMarkdownHtml.includes(
		'data-ui-zh="未填写" data-ui-en="Not provided">Not provided</span>',
	),
);
for (const authoredText of markdownAuthored) {
	assert(markdownHtml.includes(authoredText));
	assert(!markdownHtml.includes(`data-ui-zh="${authoredText}"`));
	assert(!markdownHtml.includes(`data-ui-en="${authoredText}"`));
}
const markdownMarkerPairs = [markdownHtml, emptyMarkdownHtml].flatMap((html) =>
	[...html.matchAll(/data-ui-zh="([^"]*)" data-ui-en="([^"]*)"/gu)].map(
		(match) => ({ zh: match[1], en: match[2] }),
	),
);

const script = /<script>([\s\S]*?)<\/script>/u.exec(errorHtml)?.[1] ?? "";
const start = script.indexOf('(() => {\n  const KEY = "pi-flow-language";');
const end = script.indexOf("\n\n(() => {\n  const formatElapsedMinutes", start);
assert(
	start >= 0 && end > start,
	"language runtime was not found in the hashed script",
);
const runtime = script.slice(start, end);
assert(
	!runtime.includes("location.reload"),
	"language switching must not navigate",
);

class FakeElement {
	constructor(attributes = {}) {
		this.map = new Map(Object.entries(attributes));
		this.textContent = "UNCHANGED";
		this.dataset = new Proxy(
			{},
			{
				get: (_target, key) =>
					this.map.get(
						`data-${String(key).replace(/[A-Z]/gu, (value) => `-${value.toLowerCase()}`)}`,
					),
			},
		);
	}
	get attributes() {
		return [...this.map].map(([name, value]) => ({ name, value }));
	}
	getAttribute(name) {
		return this.map.get(name) ?? null;
	}
	setAttribute(name, value) {
		this.map.set(name, String(value));
	}
	closest(selector) {
		return selector === "[data-language-option]" &&
			this.map.has("data-language-option")
			? this
			: null;
	}
	querySelector() {
		return null;
	}
}

const root = new FakeElement({
	"data-report-default-language": "en",
	"data-report-title-zh": "中文标题",
	"data-report-title-en": "English title",
});
root.dataset.reportDefaultLanguage = "en";
root.classList = { contains: () => false };
root.lang = "";
const marked = new FakeElement({
	"data-ui-zh": "中文界面",
	"data-ui-en": "English UI",
});
const markdownNodes = markdownMarkerPairs.map(
	(pair) =>
		new FakeElement({
			"data-ui-zh": pair.zh,
			"data-ui-en": pair.en,
		}),
);
const authored = new FakeElement();
const runtimeDiagnostic = "缺少 flow.json · /tmp/file · /flow go F1";
authored.textContent = runtimeDiagnostic;
const aria = new FakeElement({
	"data-ui-aria-label-zh": "关闭",
	"data-ui-aria-label-en": "Close",
});
const zhButton = new FakeElement({ "data-language-option": "zh" });
const enButton = new FakeElement({ "data-language-option": "en" });
const time = new FakeElement({
	datetime: "2026-03-01T12:34:00.000Z",
	"data-localized-time": "",
});
const listeners = new Map();
const storage = new Map([["pi-flow-language", "invalid"]]);
const document = {
	documentElement: root,
	title: "",
	readyState: "complete",
	querySelectorAll(selector) {
		if (selector === "[data-ui-zh][data-ui-en]")
			return [marked, ...markdownNodes];
		if (selector === "*")
			return [marked, ...markdownNodes, authored, aria, zhButton, enButton];
		if (selector === "[data-language-option]") return [zhButton, enButton];
		if (selector === "time[data-localized-time]") return [time];
		return [];
	},
	addEventListener(name, handler) {
		listeners.set(name, handler);
	},
	dispatchEvent() {},
};
const window = {};
vm.runInNewContext(runtime, {
	CustomEvent: class {},
	Date,
	Element: FakeElement,
	document,
	localStorage: {
		getItem: (key) => storage.get(key) ?? null,
		setItem: (key, value) => storage.set(key, value),
	},
	window,
});

assert.equal(
	root.lang,
	"en",
	"invalid preference did not fall back to renderer language",
);
assert.equal(document.title, "English title");
assert.equal(marked.textContent, "English UI");
assert.deepEqual(
	markdownNodes.map((node) => node.textContent),
	markdownMarkerPairs.map((pair) => pair.en),
);
assert.equal(aria.getAttribute("aria-label"), "Close");
assert.equal(authored.textContent, runtimeDiagnostic);
assert.equal(
	time.textContent,
	new Date(time.getAttribute("datetime")).toLocaleString("en"),
);
listeners.get("click")({ target: zhButton });
assert.equal(storage.get("pi-flow-language"), "zh");
assert.equal(root.lang, "zh-CN");
assert.equal(document.title, "中文标题");
assert.equal(marked.textContent, "中文界面");
assert.deepEqual(
	markdownNodes.map((node) => node.textContent),
	markdownMarkerPairs.map((pair) => pair.zh),
);
assert.equal(aria.getAttribute("aria-label"), "关闭");
assert.equal(zhButton.getAttribute("aria-pressed"), "true");
assert.equal(enButton.getAttribute("aria-pressed"), "false");
assert.equal(authored.textContent, runtimeDiagnostic);
assert.equal(
	time.textContent,
	new Date(time.getAttribute("datetime")).toLocaleString("zh-CN"),
);
root.map.set("data-report-default-language", "zh");
storage.set("pi-flow-language", "en");
window.piFlowLanguage.apply(window.piFlowLanguage.effective());
assert.equal(
	root.lang,
	"en",
	"stored language did not override renderer default",
);

writeFileSync(join(cwd, "flow.html"), flowHtml);
console.log("report language smoke passed");
