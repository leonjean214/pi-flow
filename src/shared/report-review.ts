import type {
	CheckModelSnapshot,
	CheckModelStatus,
	CheckPhase,
	CheckResult,
	CheckRoundAdvisor,
	GoalChecks,
} from "../goal/types.js";
import { type Language, reviewToggles } from "./config.js";
import { type ReportUiText, reportUiCopy, reportUiText } from "./copy.js";
import { renderMarkdownBlock } from "./html-markdown.js";
import { roundLabel } from "./progress-labels.js";
import {
	escapeHtml,
	hintMark,
	localizedText,
	modelHoverChip,
	TONE,
	type Tone,
	TYPE,
} from "./report-blocks.js";
import { elapsedTimeHtml } from "./report-html.js";
import { type ReportIconName, reportIcon } from "./report-icons.js";
import { formatReviewResultLines } from "./review-format.js";

/** 检查视图上下文：keyPrefix 跨卡片唯一；live 表示步骤正在执行（允许推导修复态）。 */
export interface CheckViewContext {
	keyPrefix: string;
	language: Language;
	live?: boolean;
	/** 已完成步骤的检查状态由步骤右上角承载，避免重复显示两个「已通过」。 */
	hidePassedStatus?: boolean;
	/** 待执行步骤已由父级显示，不重复显示「等待」。 */
	hideWaitingStatus?: boolean;
	/** full：round 详情直接展开（用于步骤模态框内，避免模态嵌套）。默认 modal。 */
	detail?: "modal" | "full";
	/** 顾问咨询进行中（consulting）时展示的顾问模型；缺省只显示通用文案。 */
	advisorModel?: { label: string; thinking?: string };
}

/** 丢弃 active checkpoint，保留轮次结论：仅用于明确取消。 */
export function discardActiveChecks<T extends GoalChecks | null | undefined>(
	checks: T,
): T {
	if (!checks) return checks;
	return {
		...checks,
		acceptance: { ...checks.acceptance, active: null },
		quality: { ...checks.quality, active: null },
	};
}

export function pendingChecks(): GoalChecks {
	const toggles = reviewToggles();
	return {
		acceptance: { enabled: toggles.acceptance, rounds: [], active: null },
		quality: { enabled: toggles.quality, rounds: [], active: null },
	};
}

interface PhaseMeta {
	key: "acceptance" | "quality";
	name: ReportUiText;
	hint: ReportUiText;
	icon: ReportIconName;
	accent: Tone;
}

function phaseMetas(_language: Language): PhaseMeta[] {
	return [
		{
			key: "acceptance",
			name: reportUiCopy("completionAcceptance"),
			hint: reportUiCopy("completionAcceptanceHint"),
			icon: "target",
			accent: "blue",
		},
		{
			key: "quality",
			name: reportUiCopy("qualityCheck"),
			hint: reportUiCopy("qualityCheckHint"),
			icon: "shield-check",
			accent: "green",
		},
	];
}

export function checkPhases(checks: GoalChecks, ctx: CheckViewContext) {
	return phaseMetas(ctx.language)
		.map((meta) => checkPhaseCard(checks[meta.key], meta, ctx))
		.join("");
}

function checkPhaseCard(
	phase: CheckPhase,
	meta: PhaseMeta,
	ctx: CheckViewContext,
) {
	const state = phaseState(phase, meta.key, ctx.language, ctx.live);
	const history = phaseHistory(phase, meta, ctx);
	const active = activeRoundItem(phase, meta, ctx);
	const consulting = phase.consulting && ctx.live ? consultingItem(ctx) : "";
	const rows = [history, active, consulting].filter(Boolean).join("");
	if (!phase.enabled && !rows) return "";
	const tone = state.tone === "gray" ? undefined : state.tone;
	const surface = tone ? TONE[tone].sealBg : "bg-[var(--report-surface-soft)]";
	const status = phaseStatusHtml(phase, state, ctx);
	const titleTone =
		phase.enabled && state.tone === "gray" ? meta.accent : state.tone;
	return `<section data-rough-card${tone ? ` data-tone="${tone}"` : ""} class="${surface} p-4">
<div class="flex items-start justify-between gap-3">${checkTitle(meta, titleTone, ctx.language)}${status}</div>
${rows ? `<ol class="mt-3 [&>[data-advisor-consulting]]:mt-2">${rows}</ol>` : ""}
</section>`;
}

function checkTitle(meta: PhaseMeta, tone: Tone, language: Language = "zh") {
	return `<div class="inline-flex min-w-0 items-center gap-2">
<span class="${TONE[tone].text}">${reportIcon(meta.icon, "h-5 w-5")}</span>
<p class="text-base font-semibold leading-6 text-stone-900 dark:text-stone-100">${localizedText(meta.name, language)}</p>
${hintMark(meta.hint, language)}
</div>`;
}

function phaseStatusHtml(
	phase: CheckPhase,
	state: PhaseView,
	ctx: CheckViewContext,
) {
	if (!phase.enabled) return "";
	// 顾问咨询进行中：阶段状态换成 indigo「顾问介入中」（仅执行中的步骤）。
	if (phase.consulting && ctx.live)
		return `<span class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-indigo-700 dark:text-indigo-300">${reportIcon("loader-circle", "h-3.5 w-3.5 spin-soft")}<span>${localizedText(reportUiText("顾问介入中", "Advisor consulting"), ctx.language)}</span></span>`;
	if (ctx.hidePassedStatus && state.tone === "green") return "";
	if (ctx.hideWaitingStatus && state.tone === "gray") return "";
	return phaseStatusText(state, ctx.language);
}

/** 进行态：轮次列表尾部虚线中间的 spinner pill（与完成态同一视觉位）。 */
function consultingItem(ctx: CheckViewContext) {
	const model = ctx.advisorModel
		? ` · <span class="font-mono font-medium">${escapeHtml(ctx.advisorModel.label)}</span>${ctx.advisorModel.thinking ? `<span class="pl-1 text-[10px] font-normal text-indigo-500/70 dark:text-indigo-300/60">${escapeHtml(ctx.advisorModel.thinking)}</span>` : ""}`
		: "";
	return `<li data-advisor-consulting><div class="flex items-center gap-2.5">${advisorDash()}<span class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--tone-indigo-surface)] px-2.5 py-1 text-[11px] font-semibold text-indigo-800 dark:text-indigo-300"><span class="text-indigo-600 dark:text-indigo-400">${reportIcon("loader-circle", "h-3.5 w-3.5 spin-soft")}</span>${localizedText(reportUiText("正在咨询顾问", "Consulting the advisor"), ctx.language)}${model}</span>${advisorDash()}</div></li>`;
}

function advisorDash() {
	return '<span class="flex-1 border-t border-dashed border-stone-300/80 dark:border-stone-600/80"></span>';
}

/** 完成态：轮次间虚线中间的可悬浮顾问建议胶囊。 */
function advisorSlot(advisor: CheckRoundAdvisor, language: Language) {
	const label = reportUiText("顾问建议", "Advisor advice");
	return `<div data-advisor-slot class="flex items-center gap-2.5">${advisorDash()}<span tabindex="0" data-tooltip="${escapeHtml(advisor.advice)}" data-tooltip-side="auto" data-tooltip-size="lg" class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--tone-indigo-surface)] px-2.5 py-1 text-[11px] font-semibold text-indigo-800 dark:text-indigo-300">${reportIcon("compass", "h-3.5 w-3.5")} ${localizedText(label, language)} · <span class="font-mono font-medium">${escapeHtml(advisor.model.split("/").at(-1) ?? advisor.model)}</span><span class="pl-1 text-[10px] font-normal text-indigo-500/70 dark:text-indigo-300/60">${escapeHtml(advisor.thinking)}</span></span>${advisorDash()}</div>`;
}

function phaseStatusText(state: PhaseView, language: Language = "zh") {
	if (!state.pulse)
		return `<span class="shrink-0 text-xs font-medium ${TONE[state.tone].text}">${localizedText(state.uiLabel, language)}</span>`;
	return `<span class="inline-flex shrink-0 items-center gap-1 text-xs font-medium ${TONE[state.tone].text}">${reportIcon("loader-circle", "h-3.5 w-3.5 spin-soft")}<span>${localizedText(state.uiLabel, language)}</span></span>`;
}

export interface PhaseView {
	label: string;
	uiLabel: ReportUiText;
	tone: Tone;
	pulse?: boolean;
}

export function phaseState(
	phase: CheckPhase,
	key: PhaseMeta["key"],
	language: Language = "zh",
	live = false,
): PhaseView {
	if (!phase.enabled)
		return phaseView(reportUiCopy("disabled"), language, "gray");
	if (phase.active)
		return live
			? phaseView(phaseActiveUiLabel(key), language, "blue", true)
			: phaseView(reportUiCopy("waiting"), language, "gray");
	const last = phase.rounds.at(-1);
	if (!last) return phaseView(reportUiCopy("waiting"), language, "gray");
	if (last.result === "passed")
		return phaseView(reportUiCopy("passed"), language, "green");
	if (last.result === "error")
		return phaseView(reportUiCopy("error"), language, "amber");
	if (live) return phaseView(phaseRepairUiLabel(key), language, "blue", true);
	return phaseView(reportUiCopy("failed"), language, "red");
}

function phaseView(
	uiLabel: ReportUiText,
	language: Language,
	tone: Tone,
	pulse?: boolean,
): PhaseView {
	return {
		label: uiLabel[language],
		uiLabel,
		tone,
		...(pulse ? { pulse } : {}),
	};
}

function phaseActiveUiLabel(key: PhaseMeta["key"]) {
	return reportUiCopy(key === "acceptance" ? "accepting" : "checking");
}

function phaseRepairUiLabel(key: PhaseMeta["key"]) {
	return reportUiCopy(key === "acceptance" ? "completing" : "optimizing");
}

/** stepper 用的微型检查点：验收 + 质检各一枚，保持紧凑横排。 */
export function checkDots(
	checks: GoalChecks | null | undefined,
	options: {
		goalComplete: boolean;
		language: Language;
		live?: boolean;
		criteriaChanged?: boolean;
	},
) {
	return phaseMetas(options.language)
		.map((meta) => {
			const label = phaseShortLabel(meta.key);
			const flagged = meta.key === "acceptance" && options.criteriaChanged;
			if (!checks)
				return options.goalComplete
					? checkMiniChip(
							label,
							phaseView(reportUiCopy("passed"), options.language, "green"),
							0,
							options.language,
							flagged,
						)
					: checkMiniChip(
							label,
							phaseView(reportUiCopy("waiting"), options.language, "gray"),
							0,
							options.language,
							flagged,
						);
			const phase = checks[meta.key];
			const state = phaseState(phase, meta.key, options.language, options.live);
			const roundCount = phase.rounds.length + (phase.active ? 1 : 0);
			return checkMiniChip(label, state, roundCount, options.language, flagged);
		})
		.join("");
}

function phaseShortLabel(key: PhaseMeta["key"]) {
	return key === "acceptance"
		? reportUiText("验收", "Accept")
		: reportUiText("质检", "QA");
}

function checkMiniChip(
	shortLabel: ReportUiText,
	state: PhaseView,
	roundCount: number,
	language: Language = "zh",
	criteriaChanged = false,
) {
	const badge =
		roundCount > 1
			? `<span class="${TYPE.tiny} font-bold tabular-nums ${TONE[state.tone].text}">${localizedText(reportUiText(`${roundCount}轮`, `×${roundCount}`), language)}</span>`
			: "";
	const marker = criteriaChanged
		? `<span class="font-bold text-amber-700 dark:text-amber-300">▲</span>`
		: "";
	return `<span class="inline-flex items-center gap-1 whitespace-nowrap ${TYPE.micro} font-medium leading-none ${TONE[state.tone].text}"><span class="h-1.5 w-1.5 shrink-0 rounded-full ${TONE[state.tone].dot}${state.pulse ? " pulse-soft" : ""}"></span><span>${localizedText(shortLabel, language)}</span>${badge}${marker}</span>`;
}

const MODEL_TONE: Record<CheckModelStatus, Tone> = {
	running: "blue",
	passed: "green",
	failed: "red",
	error: "amber",
};
const MODEL_ICON: Record<CheckModelStatus, string> = {
	running: reportIcon("loader-circle", "h-3 w-3 spin-soft"),
	passed: reportIcon("check", "h-3 w-3"),
	failed: reportIcon("x", "h-3 w-3"),
	error: reportIcon("warning-circle", "h-3 w-3"),
};
function phaseHistory(
	phase: CheckPhase,
	meta: PhaseMeta,
	ctx: CheckViewContext,
) {
	if (!phase.enabled || phase.rounds.length === 0) return "";
	return phase.rounds
		.map((round) => roundItem(round, phase.rounds.length, meta, ctx))
		.join("");
}

function activeRoundItem(
	phase: CheckPhase,
	meta: PhaseMeta,
	ctx: CheckViewContext,
) {
	if (!phase.enabled || !phase.active) return "";
	const startedAt = phase.active.startedAt;
	return reviewRoundItem({
		round: phase.active.round,
		models: phase.active.models.map((model) => ({
			label: model.label,
			status: model.outcome?.result ?? "running",
			...(model.outcome
				? {
						summary: model.outcome.details.trim()
							? cleanModelFeedback(model.outcome.details)
							: model.outcome.summary,
					}
				: {}),
			...(model.thinking ? { thinking: model.thinking } : {}),
		})),
		language: ctx.language,
		meta,
		live: ctx.live,
		...(startedAt === undefined
			? {}
			: {
					elapsedMs: Date.now() - startedAt,
					...(ctx.live ? { liveStartedAt: startedAt } : {}),
				}),
	});
}

function roundItem(
	round: CheckPhase["rounds"][number],
	_total: number,
	meta: PhaseMeta,
	ctx: CheckViewContext,
) {
	const models = roundModels(round, ctx.language);
	const details = ctx.detail === "full" ? round.details?.trim() : undefined;
	return reviewRoundItem({
		round: round.round,
		models,
		language: ctx.language,
		meta,
		details,
		showRule: ctx.detail !== "full",
		advisor: round.advisor,
		elapsedMs: round.elapsedMs,
	});
}

type ReviewModelSnapshot = CheckModelSnapshot & { uiLabel?: ReportUiText };

function reviewRoundItem(input: {
	round: number;
	models: ReviewModelSnapshot[];
	language: Language;
	meta: PhaseMeta;
	details?: string;
	showRule?: boolean;
	advisor?: CheckRoundAdvisor;
	elapsedMs?: number;
	liveStartedAt?: number;
	live?: boolean;
}) {
	const title = reportUiText(
		roundLabel(input.round, "zh"),
		`Round ${input.round}`,
	);
	const elapsed =
		input.elapsedMs === undefined
			? ""
			: elapsedTimeHtml(input.elapsedMs, input.liveStartedAt);
	const models = input.models
		.map((model) =>
			reviewModelChip(model, input.meta, input.language, input.live === true),
		)
		.join("");
	const detailHtml = input.details
		? renderMarkdownBlock(
				formatReviewResultLines(input.details).join("\n"),
				"mt-1 space-y-2 text-xs leading-5 text-stone-600 dark:text-stone-300",
				input.language,
			)
		: "";
	// 顾问建议占据该轮尾部的虚线位（一等事实，不藏进详情）；无顾问时维持普通分隔线。
	const rule =
		input.showRule === false
			? ""
			: `<div data-round-rule class="my-2.5 border-t border-dashed border-stone-300/80 dark:border-stone-600/80" aria-hidden="true"></div>`;
	const advisor = input.advisor
		? `<div class="mt-2">${advisorSlot(input.advisor, input.language)}</div>`
		: "";
	const nextRoundGap = input.advisor ? " [&+li]:mt-3" : "";
	// 轮次 meta 独占一行。双列 max-content grid + w-fit：虚线跟模型块同宽。
	return `<li class="[&:last-child_[data-round-rule]]:hidden${nextRoundGap}"><div><p class="flex items-center justify-between gap-3 ${TYPE.meta} font-medium tabular-nums tracking-[0.01em] text-stone-500 dark:text-stone-400"><span>${localizedText(title, input.language)}</span>${elapsed}</p><div class="mt-1.5 w-fit max-w-full"><div class="grid w-fit max-w-full gap-1.5 [grid-template-columns:repeat(2,max-content)]">${models}</div>${input.advisor ? "" : rule}</div>${advisor}${detailHtml}</div></li>`;
}

function roundModels(
	round: CheckPhase["rounds"][number],
	language: Language,
): ReviewModelSnapshot[] {
	const details = round.details?.trim();
	const sections = modelSections(details ?? "");
	if (round.models?.length)
		return round.models.map((model, index) => {
			const section =
				sections.find((item) => item.label === model.label) ??
				(sections.length === round.models?.length
					? sections[index]
					: undefined);
			const summary =
				section?.body ??
				(round.models?.length === 1 && details
					? cleanModelFeedback(details)
					: model.summary);
			return summary ? { ...model, summary } : model;
		});
	const source = [round.details, round.summary].filter(Boolean).join("\n\n");
	const fallbackSections = modelSections(source);
	if (fallbackSections.length > 0)
		return fallbackSections.map((section) => ({
			label: section.label,
			status: roundResultModelStatus(round.result),
			summary: section.body,
		}));
	const fallbackLabel = resultUiLabel(round.result);
	return [
		{
			label: fallbackLabel[language],
			uiLabel: fallbackLabel,
			status: roundResultModelStatus(round.result),
			summary: [round.summary, round.details].filter(Boolean).join("\n\n"),
		},
	];
}

function modelSections(text: string) {
	const normalized = text.replace(/^(PASS|FAIL)\s*/iu, "").trim();
	const pattern =
		/(?:^|\n)(?:模型|Model)\s+\d+\s+·\s+([^\n]+)\n([\s\S]*?)(?=\n\n(?:模型|Model)\s+\d+\s+·|$)/giu;
	return [...normalized.matchAll(pattern)]
		.map((match) => ({
			label: match[1].trim(),
			body: cleanModelFeedback(match[2]),
		}))
		.filter((item) => item.label);
}

function cleanModelFeedback(text: string) {
	return formatReviewResultLines(text).join("\n").trim();
}

function roundResultModelStatus(result: CheckResult): CheckModelStatus {
	if (result === "passed") return "passed";
	if (result === "failed") return "failed";
	return "error";
}

function resultUiLabel(result: CheckResult) {
	if (result === "passed") return reportUiText("通过", "passed");
	if (result === "failed") return reportUiCopy("failed");
	return reportUiCopy("error");
}

function reviewModelChip(
	model: ReviewModelSnapshot,
	meta: PhaseMeta,
	language: Language,
	live: boolean,
) {
	const running = model.status === "running";
	return modelHoverChip({
		label: model.uiLabel ?? model.label,
		tooltip: modelTooltip(model, meta.key, live),
		language,
		iconHtml:
			running && !live
				? reportIcon("pause", "h-3 w-3")
				: MODEL_ICON[model.status],
		iconTone: running && !live ? "gray" : MODEL_TONE[model.status],
		...(model.thinking ? { thinking: model.thinking } : {}),
	});
}

function modelTooltip(
	model: CheckModelSnapshot,
	key: PhaseMeta["key"],
	live: boolean,
) {
	if (model.summary?.trim()) return model.summary.trim();
	if (model.status === "running")
		return live ? phaseActiveUiLabel(key) : reportUiCopy("waiting");
	return reportUiCopy("noDetailedOutput");
}
