import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GoalChecks } from "../goal/types.js";
import type { Language } from "../shared/config.js";
import type { ContextEvidenceResult } from "../shared/context-evidence.js";
import { type ReportUiText, reportUiText } from "../shared/copy.js";
import { roundLabel } from "../shared/progress-labels.js";
import {
	escapeHtml,
	escapeHtmlLiteral,
	localizedAttribute,
	localizedText,
	modal,
	modalTrigger,
	pageShell,
	reportControls,
	statusText,
	TONE,
	type Tone,
	TYPE,
} from "../shared/report-blocks.js";
import { notifyReportChanged } from "../shared/report-client.js";
import { flowLogoDataUri } from "../shared/report-html.js";
import { reportIcon } from "../shared/report-icons.js";
import { checkPhases } from "../shared/report-review.js";
import { currentSessionFile } from "../shared/session.js";
import type { ReviewCheckpointState } from "./checkpoint.js";

export function reviewReportPath(
	ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
) {
	const sessionFile = currentSessionFile(ctx);
	if (!sessionFile) throw new Error("当前会话没有持久化文件，无法生成质检报告");
	const fileName = basename(sessionFile);
	const extension = extname(fileName);
	const sessionName = extension
		? fileName.slice(0, -extension.length)
		: fileName;
	return join(ctx.cwd, ".flow", "reviews", `${sessionName}.html`);
}

export function writeReviewReport(
	ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
	checkpoint: ReviewCheckpointState,
	language: Language,
	evidence: ContextEvidenceResult,
) {
	const path = reviewReportPath(ctx);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, renderReviewReport(checkpoint, language, evidence));
	notifyReportChanged(path);
	return path;
}

export function renderReviewReport(
	checkpoint: ReviewCheckpointState,
	language: Language,
	evidence: ContextEvidenceResult,
) {
	const updatedAt = new Date();
	const title = reportUiText("Flow — 独立质检", "Flow — Quality review");
	return pageShell(
		title[language],
		[
			brandHeader(language),
			headerCard(checkpoint, language),
			roundsSection(checkpoint, language),
			footer(updatedAt, checkpoint, evidence, language),
		].join("\n"),
		{ language, themeToggle: false, title },
	);
}

function brandHeader(language: Language) {
	const logo = flowLogoDataUri();
	const mark = logo
		? `<img src="${logo}" alt="Flow" class="h-full w-full rounded-xl object-cover" />`
		: reportIcon("sparkle", "h-6 w-6 text-stone-900 dark:text-stone-100");
	return `<div class="flex items-center justify-between gap-3 px-1 pb-1" ${localizedAttribute("aria-label", reportUiText("Flow 质检", "Flow Review"), language)}>
<div class="flex min-w-0 items-center gap-3">
<span class="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--report-surface)] p-1 shadow-[0_0_0_1px_var(--ring-subtle),0_10px_24px_var(--shadow-chip)]">${mark}</span>
<span class="font-serif text-3xl font-semibold tracking-[-0.055em] text-stone-950 dark:text-stone-50">Flow</span>
<span class="text-sm font-medium text-stone-400 dark:text-stone-500">/ ${localizedText(reportUiText("质检", "Review"), language)}</span>
</div>
${reportControls(language)}
</div>`;
}

function headerCard(checkpoint: ReviewCheckpointState, language: Language) {
	const state = reportState(checkpoint, language);
	return `<header data-review-report data-rough-card data-tone="${state.tone}" class="bg-[var(--report-surface)] px-6 py-5">
<div class="flex flex-wrap items-start justify-between gap-4">
<div class="min-w-0 flex-1">
<h1 class="font-serif text-3xl leading-snug text-stone-900 dark:text-stone-100">${localizedText(reportUiText("独立质检", "Standalone quality review"), language)}</h1>
<p class="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">${localizedText(reportUiText("当前会话当前任务的交付质量", "Delivery quality for the current task in this conversation"), language)}</p>
</div>
${statusText(state.uiLabel, state.tone, language)}
</div>
<div class="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-dashed border-stone-200 pt-4 dark:border-stone-700">
<span class="inline-flex items-center gap-1.5 ${TYPE.meta} font-medium ${TONE[state.tone].text}">${reportIcon("shield-check", "h-4 w-4")} ${localizedText(state.round === 0 ? reportUiText("等待第 1 轮", "First review pending") : reportUiText(roundLabel(state.round, "zh"), roundLabel(state.round, "en")), language)}</span>
<span class="${TYPE.meta} text-stone-400 dark:text-stone-500">${localizedText(roundProgress(checkpoint), language)}</span>
</div>
</header>`;
}

function evidenceRecord(
	checkpoint: ReviewCheckpointState,
	evidence: ContextEvidenceResult,
	language: Language,
) {
	const label = reportUiText("质检证据", "Review evidence");
	return `${modalTrigger({
		id: "dlg-review-evidence",
		label,
		language,
		icon: "notebook",
	})}${modal({
		id: "dlg-review-evidence",
		title: label,
		icon: "notebook",
		body: evidenceBody(checkpoint, evidence, language),
		language,
	})}`;
}

function evidenceBody(
	checkpoint: ReviewCheckpointState,
	evidence: ContextEvidenceResult,
	language: Language,
) {
	if (!evidence.ok)
		return `<div data-context-evidence-error class="rounded-xl bg-[var(--tone-amber-surface)] p-4 text-sm leading-6 text-amber-900 dark:text-amber-200">
<p class="font-medium">${localizedText(reportUiText("证据未能提供给质检模型", "Evidence was not provided to the review models."), language)}</p>
<p class="mt-1">${escapeHtmlLiteral(evidence.error.message)}</p>
</div>`;
	const provided = checkpoint.active !== null || checkpoint.history.length > 0;
	const note = provided
		? reportUiText(
				"以下内容已作为证据提供给质检模型",
				"The following content was provided to the review models as evidence.",
			)
		: reportUiText(
				"以下内容将作为证据提供给质检模型",
				"The following content will be provided to the review models as evidence.",
			);
	return `<p data-review-evidence-note class="text-sm font-medium leading-6 text-stone-700 dark:text-stone-300">${localizedText(note, language)}</p>
<pre data-context-evidence class="mt-4 rounded-xl bg-[var(--report-surface-muted)] p-4 font-mono text-xs leading-5 text-stone-700 dark:text-stone-300">${escapeHtmlLiteral(evidence.packet.text)}</pre>`;
}

function roundsSection(checkpoint: ReviewCheckpointState, language: Language) {
	const checks: GoalChecks = {
		acceptance: { enabled: false, rounds: [], active: null },
		quality: {
			enabled: true,
			rounds: checkpoint.history,
			active: checkpoint.active,
		},
	};
	return `<section data-review-rounds class="space-y-3">
<h2 class="px-1 text-sm font-semibold text-stone-700 dark:text-stone-300">${localizedText(reportUiText("质检轮次", "Review rounds"), language)}</h2>
${checkPhases(checks, {
	keyPrefix: "standalone-review",
	language,
	live: checkpoint.phase !== null,
})}
</section>`;
}

function footer(
	updatedAt: Date,
	checkpoint: ReviewCheckpointState,
	evidence: ContextEvidenceResult,
	language: Language,
) {
	const timestamp = updatedAt.toISOString();
	const displayed = updatedAt.toLocaleString(
		language === "en" ? "en" : "zh-CN",
	);
	return `<footer class="grid items-center gap-3 px-1 sm:grid-cols-2">
<div class="justify-self-start">${evidenceRecord(checkpoint, evidence, language)}</div>
<p class="justify-self-end ${TYPE.meta} tabular-nums text-stone-400 dark:text-stone-500">${localizedText(reportUiText("更新于", "Updated"), language)} <time data-localized-time datetime="${timestamp}">${escapeHtml(displayed)}</time></p>
</footer>`;
}

function reportState(checkpoint: ReviewCheckpointState, _language: Language) {
	if (checkpoint.phase === "awaiting_agent" && checkpoint.round === 0)
		return reviewState(
			reportUiText(
				"执行中 · 完成后自动质检",
				"Running · quality check when done",
			),
			"blue",
			0,
		);
	if (checkpoint.phase === "checking")
		return reviewState(
			reportUiText("质检中", "Quality check in progress"),
			"blue",
			checkpoint.active?.round ?? Math.max(1, checkpoint.round),
		);
	if (checkpoint.phase === "awaiting_agent")
		return reviewState(
			reportUiText("优化中", "Quality fix in progress"),
			"blue",
			Math.max(1, checkpoint.round),
		);
	const last = checkpoint.history.at(-1);
	if (last?.result === "passed")
		return reviewState(reportUiText("已通过", "Passed"), "green", last.round);
	if (last?.result === "failed")
		return reviewState(reportUiText("未通过", "Failed"), "red", last.round);
	return reviewState(
		last ? reportUiText("错误", "Error") : reportUiText("等待", "Waiting"),
		last ? "amber" : "gray",
		last?.round ?? Math.max(1, checkpoint.round),
	);
}

function reviewState(uiLabel: ReportUiText, tone: Tone, round: number) {
	return { uiLabel, tone, round };
}

function roundProgress(checkpoint: ReviewCheckpointState) {
	if (checkpoint.phase === "awaiting_agent" && checkpoint.round === 0)
		return reportUiText(
			"执行完成后自动开始",
			"Starts automatically after execution",
		);
	const active = checkpoint.active;
	if (active) {
		const settled = active.models.filter((model) => model.outcome).length;
		return reportUiText(
			`${settled}/${active.models.length} 个模型已结算`,
			`${settled}/${active.models.length} models settled`,
		);
	}
	const rounds = checkpoint.history.length;
	return reportUiText(
		`已记录 ${rounds} 轮`,
		`${rounds} ${rounds === 1 ? "round" : "rounds"} recorded`,
	);
}
