/**
 * Parse OpenDesign Coding Plan quota payloads (Vela billing preflight JSON).
 */

import type { RateWindow } from "../../types.js";
import { formatReset } from "../../utils.js";

const FIVE_HOURS_SECONDS = 18_000;
const WEEK_SECONDS = 604_800;
const DAY_SECONDS = 86_400;
const HOUR_SECONDS = 3_600;

export interface CodingPlanWindow {
	policyId?: string;
	durationSeconds?: number;
	resetMode?: string;
	usedCredits?: string;
	limitCredits?: string;
	remainingCredits?: string;
	windowStart?: string | null;
	resetsAt?: string | null;
}

export interface CodingPlanPayload {
	eligible?: boolean;
	windows?: CodingPlanWindow[];
}

export interface BillingPreflightPayload {
	codingPlan?: CodingPlanPayload;
}

function creditCount(raw: unknown): bigint | null {
	return typeof raw === "string" && /^\d+$/.test(raw) ? BigInt(raw) : null;
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

export function labelForCodingPlanDuration(durationSeconds: number): string {
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		return "Usage";
	}
	if (durationSeconds === FIVE_HOURS_SECONDS) return "5h";
	if (durationSeconds === WEEK_SECONDS) return "Week";
	if (durationSeconds >= 28 * DAY_SECONDS) return "Month";
	if (durationSeconds < DAY_SECONDS && durationSeconds % HOUR_SECONDS === 0) {
		return `${durationSeconds / HOUR_SECONDS}h`;
	}
	if (durationSeconds % DAY_SECONDS === 0) {
		return `${durationSeconds / DAY_SECONDS}d`;
	}
	return `${Math.round(durationSeconds / HOUR_SECONDS)}h`;
}

function parseResetAt(value: unknown): Date | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

export function windowsFromCodingPlan(plan: CodingPlanPayload | undefined): RateWindow[] {
	if (!plan?.windows?.length) return [];

	const parsed: Array<{ durationSeconds: number; window: RateWindow }> = [];
	for (const entry of plan.windows) {
		const durationSeconds = entry.durationSeconds;
		if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
			continue;
		}

		const used = creditCount(entry.usedCredits);
		const limit = creditCount(entry.limitCredits);
		if (used === null || limit === null || limit === 0n) continue;

		const basisPoints = Number((used * 10_000n) / limit);
		const usedPercent = clampPercent(Math.round(basisPoints / 100));
		const resetDate = parseResetAt(entry.resetsAt);

		parsed.push({
			durationSeconds,
			window: {
				label: labelForCodingPlanDuration(durationSeconds),
				usedPercent,
				resetDescription: resetDate ? formatReset(resetDate) : undefined,
				resetAt: resetDate?.toISOString(),
			},
		});
	}

	parsed.sort((left, right) => left.durationSeconds - right.durationSeconds);
	return parsed.map((entry) => entry.window);
}

export function parseBillingPreflightJson(text: string): RateWindow[] {
	let data: BillingPreflightPayload;
	try {
		data = JSON.parse(text) as BillingPreflightPayload;
	} catch {
		return [];
	}
	return windowsFromCodingPlan(data.codingPlan);
}

export function parseBillingResponseJson(text: string): RateWindow[] {
	let data: { preflight?: BillingPreflightPayload };
	try {
		data = JSON.parse(text) as { preflight?: BillingPreflightPayload };
	} catch {
		return [];
	}
	if (data.preflight?.codingPlan) {
		return windowsFromCodingPlan(data.preflight.codingPlan);
	}
	return parseBillingPreflightJson(text);
}

interface OpenCodeUsageWindow {
	percent?: number;
	resetsAt?: string;
}

interface OpenCodeUsageResponse {
	usage?: {
		rolling?: OpenCodeUsageWindow;
		weekly?: OpenCodeUsageWindow;
		monthly?: OpenCodeUsageWindow;
	};
}

function pushOpenCodeWindow(
	windows: RateWindow[],
	label: string,
	window: OpenCodeUsageWindow | undefined
): void {
	if (!window || typeof window.percent !== "number" || !Number.isFinite(window.percent)) return;
	const resetDate =
		typeof window.resetsAt === "string" && window.resetsAt.trim()
			? new Date(window.resetsAt)
			: undefined;
	const validReset = resetDate && !Number.isNaN(resetDate.getTime()) ? resetDate : undefined;
	windows.push({
		label,
		usedPercent: clampPercent(window.percent),
		resetDescription: validReset ? formatReset(validReset) : undefined,
		resetAt: validReset?.toISOString(),
	});
}

/** OpenCode Go-shaped usage JSON if OpenDesign Link adds a compatible endpoint. */
export function parseLinkUsageJson(text: string): RateWindow[] {
	let data: OpenCodeUsageResponse;
	try {
		data = JSON.parse(text) as OpenCodeUsageResponse;
	} catch {
		return [];
	}
	const windows: RateWindow[] = [];
	pushOpenCodeWindow(windows, "5h", data.usage?.rolling);
	pushOpenCodeWindow(windows, "Week", data.usage?.weekly);
	pushOpenCodeWindow(windows, "Month", data.usage?.monthly);
	return windows;
}
