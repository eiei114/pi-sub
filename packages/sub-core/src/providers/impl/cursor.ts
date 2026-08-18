/**
 * Cursor usage provider (unofficial APIs)
 */

import * as path from "node:path";
import type { Dependencies, RateWindow, UsageSnapshot } from "../../types.js";
import { BaseProvider } from "../../provider.js";
import { noCredentials, fetchFailed, httpError, apiError } from "../../errors.js";
import { formatReset, createTimeoutController } from "../../utils.js";
import { API_TIMEOUT_MS, CURSOR_AUTH_USAGE_URL, CURSOR_USAGE_SUMMARY_URL } from "../../config.js";

function normalizeToken(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Load Cursor credentials from Pi auth.json (preferred) or env.
 * Supports oauth-style `{ access }` and api-key-style `{ type, key }`.
 */
function loadCursorToken(deps: Dependencies): string | undefined {
	const envToken = normalizeToken(
		deps.env.CURSOR_API_KEY ?? deps.env.CURSOR_ACCESS_TOKEN ?? deps.env.CURSOR_OAUTH_TOKEN
	);
	if (envToken) return envToken;

	const authPath = path.join(deps.homedir(), ".pi", "agent", "auth.json");
	try {
		if (!deps.fileExists(authPath)) return undefined;
		const auth = JSON.parse(deps.readFile(authPath) ?? "{}") as Record<string, unknown>;
		const entry = auth.cursor;
		if (typeof entry === "string") return normalizeToken(entry);
		if (!isRecord(entry)) return undefined;
		return (
			normalizeToken(entry.access)
			?? normalizeToken(entry.key)
			?? normalizeToken(entry.apiKey)
			?? normalizeToken(entry.token)
		);
	} catch {
		return undefined;
	}
}

function extractCursorUserId(accessToken: string): string | undefined {
	try {
		const parts = accessToken.split(".");
		if (parts.length < 2) return undefined;
		const payloadJson = Buffer.from(parts[1]!, "base64url").toString("utf8");
		const payload = JSON.parse(payloadJson) as { sub?: unknown };
		if (typeof payload.sub !== "string" || !payload.sub.trim()) return undefined;
		const subParts = payload.sub.split("|");
		const userId = (subParts.length > 1 ? subParts[1] : payload.sub).trim();
		return userId || undefined;
	} catch {
		return undefined;
	}
}

function parseResetAt(payload: Record<string, unknown>): Date | undefined {
	for (const key of ["billingCycleEnd", "endOfMonth", "resetsAt", "nextReset"]) {
		const value = payload[key];
		if (typeof value === "string") {
			const date = new Date(value);
			if (!Number.isNaN(date.getTime())) return date;
		}
		const numeric = toFiniteNumber(value);
		if (numeric !== undefined) {
			const ms = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
			return new Date(ms);
		}
	}
	for (const key of ["startOfMonth", "billingCycleStart", "startOfBillingCycle"]) {
		const value = payload[key];
		let start: Date | undefined;
		if (typeof value === "string") {
			const date = new Date(value);
			if (!Number.isNaN(date.getTime())) start = date;
		} else {
			const numeric = toFiniteNumber(value);
			if (numeric !== undefined) {
				const ms = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
				start = new Date(ms);
			}
		}
		if (start) {
			start.setUTCMonth(start.getUTCMonth() + 1);
			return start;
		}
	}
	return undefined;
}

function pushPercentWindow(
	windows: RateWindow[],
	label: string,
	usedPercent: number,
	resetDate?: Date
): void {
	windows.push({
		label,
		usedPercent: clampPercent(usedPercent),
		resetDescription: resetDate ? formatReset(resetDate) : undefined,
		resetAt: resetDate?.toISOString(),
	});
}

function parseCentsBucket(bucket: Record<string, unknown>): number | undefined {
	if (bucket.enabled === false) return undefined;
	const limit = toFiniteNumber(bucket.limit);
	const used = toFiniteNumber(bucket.used);
	const remaining = toFiniteNumber(bucket.remaining);
	if (limit === undefined || limit <= 0) return undefined;
	let usedCents: number | undefined;
	if (used !== undefined && used >= 0) {
		usedCents = used;
	} else if (remaining !== undefined && remaining >= 0) {
		usedCents = Math.max(0, limit - remaining);
	}
	if (usedCents === undefined) return undefined;
	return clampPercent((usedCents / limit) * 100);
}

/**
 * Map usage-summary individualUsage into Models / Other / On-Demand rails.
 */
function windowsFromUsageSummary(payload: unknown): RateWindow[] {
	if (!isRecord(payload) || !isRecord(payload.individualUsage)) return [];
	const resetDate = parseResetAt(payload);
	const individual = payload.individualUsage;
	const windows: RateWindow[] = [];

	const overall = isRecord(individual.overall) ? individual.overall : null;
	const plan = isRecord(individual.plan) ? individual.plan : null;
	let usedOverall = false;

	if (overall) {
		const pct = parseCentsBucket(overall);
		if (pct !== undefined) {
			usedOverall = true;
			pushPercentWindow(windows, "Personal", pct, resetDate);
		}
	}

	if (!usedOverall && plan) {
		const autoPct = toFiniteNumber(plan.autoPercentUsed);
		const apiPct = toFiniteNumber(plan.apiPercentUsed);
		const totalPct = toFiniteNumber(plan.totalPercentUsed);
		if (autoPct !== undefined) {
			pushPercentWindow(windows, "Models", autoPct, resetDate);
		}
		if (apiPct !== undefined) {
			pushPercentWindow(windows, "Other", apiPct, resetDate);
		}
		if (autoPct === undefined && apiPct === undefined) {
			if (totalPct !== undefined) {
				pushPercentWindow(windows, "Personal", totalPct, resetDate);
			} else {
				const centsPct = parseCentsBucket(plan);
				if (centsPct !== undefined) {
					pushPercentWindow(windows, "Personal", centsPct, resetDate);
				}
			}
		}
	}

	if (isRecord(individual.onDemand)) {
		const onDemandPct = parseCentsBucket(individual.onDemand);
		if (onDemandPct !== undefined) {
			pushPercentWindow(windows, "On-Demand", onDemandPct, resetDate);
		}
	}

	return windows;
}

function windowsFromLegacyUsage(payload: unknown): RateWindow[] {
	if (!isRecord(payload)) return [];
	const resetDate = parseResetAt(payload);
	const windows: RateWindow[] = [];

	for (const [key, value] of Object.entries(payload)) {
		if (!isRecord(value)) continue;
		const usedVal =
			toFiniteNumber(value.numRequests)
			?? toFiniteNumber(value.used)
			?? toFiniteNumber(value.amountUsed)
			?? toFiniteNumber(value.usdUsed);
		const limitVal =
			toFiniteNumber(value.maxRequestUsage)
			?? toFiniteNumber(value.limit)
			?? toFiniteNumber(value.amountLimit)
			?? toFiniteNumber(value.usdLimit);
		if (usedVal === undefined || limitVal === undefined || limitVal <= 0) continue;
		pushPercentWindow(windows, key, (usedVal / limitVal) * 100, resetDate);
	}

	return windows;
}

export class CursorProvider extends BaseProvider {
	readonly name = "cursor" as const;
	readonly displayName = "Cursor";

	hasCredentials(deps: Dependencies): boolean {
		return Boolean(loadCursorToken(deps));
	}

	async fetchUsage(deps: Dependencies): Promise<UsageSnapshot> {
		const token = loadCursorToken(deps);
		if (!token) {
			return this.emptySnapshot(noCredentials());
		}

		const { controller, clear } = createTimeoutController(API_TIMEOUT_MS);

		try {
			const userId = extractCursorUserId(token);
			const bearerHeaders = {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
			};

			const legacyPromise = deps
				.fetch(CURSOR_AUTH_USAGE_URL, {
					method: "GET",
					headers: bearerHeaders,
					signal: controller.signal,
				})
				.then(async (res) => {
					if (!res.ok) return { ok: false as const, status: res.status, windows: [] as RateWindow[] };
					try {
						const data = await res.json();
						return { ok: true as const, status: res.status, windows: windowsFromLegacyUsage(data) };
					} catch {
						return { ok: false as const, status: res.status, windows: [] as RateWindow[] };
					}
				})
				.catch(() => ({ ok: false as const, status: 0, windows: [] as RateWindow[] }));

			const summaryPromise = userId
				? deps
						.fetch(CURSOR_USAGE_SUMMARY_URL, {
							method: "GET",
							headers: {
								Accept: "application/json",
								Cookie: `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${token}`)}`,
							},
							signal: controller.signal,
						})
						.then(async (res) => {
							if (!res.ok) return { ok: false as const, status: res.status, windows: [] as RateWindow[] };
							try {
								const data = await res.json();
								return { ok: true as const, status: res.status, windows: windowsFromUsageSummary(data) };
							} catch {
								return { ok: false as const, status: res.status, windows: [] as RateWindow[] };
							}
						})
						.catch(() => ({ ok: false as const, status: 0, windows: [] as RateWindow[] }))
				: Promise.resolve({ ok: false as const, status: 0, windows: [] as RateWindow[] });

			const [legacy, summary] = await Promise.all([legacyPromise, summaryPromise]);
			clear();

			// Prefer dashboard rails (Models/Other/On-Demand) when present.
			const windows = summary.windows.length > 0 ? summary.windows : legacy.windows;
			if (windows.length > 0) {
				return this.snapshot({ windows });
			}

			if (summary.status === 401 || legacy.status === 401) {
				return this.emptySnapshot(httpError(401));
			}
			if (summary.status >= 400 || legacy.status >= 400) {
				const status = summary.status >= 400 ? summary.status : legacy.status;
				return this.emptySnapshot(httpError(status));
			}

			return this.emptySnapshot(apiError("Invalid Cursor usage response"));
		} catch {
			clear();
			return this.emptySnapshot(fetchFailed());
		}
	}
}
