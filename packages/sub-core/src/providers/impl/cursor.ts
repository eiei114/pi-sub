/**
 * Cursor usage provider (unofficial APIs)
 *
 * Auth notes:
 * - Pi `/login` Cursor often stores `{ type: "api_key", key: "crsr_…" }`.
 * - Raw `crsr_` keys return 401 on `/auth/usage`; exchange them first via
 *   `/auth/exchange_user_api_key` to obtain a JWT access token.
 * - Models/Other rails come from DashboardService/GetCurrentPeriodUsage (Bearer).
 * - `cursor.com/api/usage-summary` needs a browser/OAuth session cookie and
 *   usually fails for API-key logins — treat it as optional.
 */

import * as path from "node:path";
import type { Dependencies, RateWindow, UsageSnapshot } from "../../types.js";
import { BaseProvider } from "../../provider.js";
import { noCredentials, fetchFailed, httpError, apiError } from "../../errors.js";
import { formatReset, createTimeoutController } from "../../utils.js";
import {
	API_TIMEOUT_MS,
	CURSOR_AUTH_USAGE_URL,
	CURSOR_CURRENT_PERIOD_USAGE_URL,
	CURSOR_EXCHANGE_API_KEY_URL,
	CURSOR_USAGE_SUMMARY_URL,
} from "../../config.js";

type FetchWindowsResult = {
	ok: boolean;
	status: number;
	windows: RateWindow[];
};

function normalizeToken(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeCursorApiKey(token: string): boolean {
	// Only user API keys need exchange. JWT access tokens are used as-is.
	return token.startsWith("crsr_");
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

		// Prefer explicit access JWT when present; otherwise API key / aliases.
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
		const numeric = toFiniteNumber(value);
		if (numeric !== undefined) {
			const ms = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
			const date = new Date(ms);
			if (!Number.isNaN(date.getTime())) return date;
		}
		if (typeof value === "string") {
			const date = new Date(value);
			if (!Number.isNaN(date.getTime())) return date;
		}
	}
	for (const key of ["startOfMonth", "billingCycleStart", "startOfBillingCycle"]) {
		const value = payload[key];
		let start: Date | undefined;
		const numeric = toFiniteNumber(value);
		if (numeric !== undefined) {
			const ms = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
			start = new Date(ms);
		} else if (typeof value === "string") {
			const date = new Date(value);
			if (!Number.isNaN(date.getTime())) start = date;
		}
		if (start && !Number.isNaN(start.getTime())) {
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
 * Map GetCurrentPeriodUsage / usage-summary plan rails into Models / Other / On-Demand.
 */
function windowsFromPlanRails(
	plan: Record<string, unknown> | null,
	onDemand: Record<string, unknown> | null,
	resetDate?: Date
): RateWindow[] {
	const windows: RateWindow[] = [];
	if (plan) {
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
	if (onDemand) {
		const onDemandPct = parseCentsBucket(onDemand);
		if (onDemandPct !== undefined) {
			pushPercentWindow(windows, "On-Demand", onDemandPct, resetDate);
		}
	}
	return windows;
}

function windowsFromUsageSummary(payload: unknown): RateWindow[] {
	if (!isRecord(payload) || !isRecord(payload.individualUsage)) return [];
	const resetDate = parseResetAt(payload);
	const individual = payload.individualUsage;
	const windows: RateWindow[] = [];

	const overall = isRecord(individual.overall) ? individual.overall : null;
	if (overall) {
		const pct = parseCentsBucket(overall);
		if (pct !== undefined) {
			pushPercentWindow(windows, "Personal", pct, resetDate);
			return windows;
		}
	}

	const plan = isRecord(individual.plan) ? individual.plan : null;
	const onDemand = isRecord(individual.onDemand) ? individual.onDemand : null;
	return windowsFromPlanRails(plan, onDemand, resetDate);
}

function windowsFromCurrentPeriodUsage(payload: unknown): RateWindow[] {
	if (!isRecord(payload)) return [];
	const resetDate = parseResetAt(payload);
	const plan = isRecord(payload.planUsage) ? payload.planUsage : null;
	const onDemand = isRecord(payload.spendLimitUsage) ? payload.spendLimitUsage : null;
	return windowsFromPlanRails(plan, onDemand, resetDate);
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

async function exchangeApiKeyForAccessToken(
	deps: Dependencies,
	apiKey: string,
	signal: AbortSignal
): Promise<{ accessToken?: string; status: number }> {
	try {
		const res = await deps.fetch(CURSOR_EXCHANGE_API_KEY_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: "{}",
			signal,
		});
		if (!res.ok) {
			return { status: res.status };
		}
		const data = (await res.json()) as { accessToken?: unknown; access_token?: unknown };
		const accessToken =
			normalizeToken(data.accessToken) ?? normalizeToken(data.access_token);
		return { accessToken, status: res.status };
	} catch {
		return { status: 0 };
	}
}

async function resolveAccessToken(
	deps: Dependencies,
	rawToken: string,
	signal: AbortSignal
): Promise<{ accessToken?: string; status: number }> {
	if (!looksLikeCursorApiKey(rawToken)) {
		return { accessToken: rawToken, status: 200 };
	}
	return exchangeApiKeyForAccessToken(deps, rawToken, signal);
}

async function fetchJsonWindows(
	deps: Dependencies,
	url: string,
	init: RequestInit,
	mapWindows: (payload: unknown) => RateWindow[]
): Promise<FetchWindowsResult> {
	try {
		const res = await deps.fetch(url, init);
		if (!res.ok) {
			return { ok: false, status: res.status, windows: [] };
		}
		try {
			const data = await res.json();
			return { ok: true, status: res.status, windows: mapWindows(data) };
		} catch {
			return { ok: false, status: res.status, windows: [] };
		}
	} catch {
		return { ok: false, status: 0, windows: [] };
	}
}

export class CursorProvider extends BaseProvider {
	readonly name = "cursor" as const;
	readonly displayName = "Cursor";

	hasCredentials(deps: Dependencies): boolean {
		return Boolean(loadCursorToken(deps));
	}

	async fetchUsage(deps: Dependencies): Promise<UsageSnapshot> {
		const rawToken = loadCursorToken(deps);
		if (!rawToken) {
			return this.emptySnapshot(noCredentials());
		}

		const { controller, clear } = createTimeoutController(API_TIMEOUT_MS);

		try {
			const exchanged = await resolveAccessToken(deps, rawToken, controller.signal);
			if (!exchanged.accessToken) {
				clear();
				if (exchanged.status === 401 || exchanged.status === 403) {
					return this.emptySnapshot(httpError(exchanged.status));
				}
				if (exchanged.status >= 400) {
					return this.emptySnapshot(httpError(exchanged.status));
				}
				return this.emptySnapshot(apiError("Cursor API key exchange failed"));
			}

			const accessToken = exchanged.accessToken;
			const bearerHeaders = {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			};

			const periodPromise = fetchJsonWindows(
				deps,
				CURSOR_CURRENT_PERIOD_USAGE_URL,
				{
					method: "POST",
					headers: {
						...bearerHeaders,
						"Content-Type": "application/json",
					},
					body: "{}",
					signal: controller.signal,
				},
				windowsFromCurrentPeriodUsage
			);

			const legacyPromise = fetchJsonWindows(
				deps,
				CURSOR_AUTH_USAGE_URL,
				{
					method: "GET",
					headers: bearerHeaders,
					signal: controller.signal,
				},
				windowsFromLegacyUsage
			);

			const userId = extractCursorUserId(accessToken);
			const summaryPromise = userId
				? fetchJsonWindows(
						deps,
						CURSOR_USAGE_SUMMARY_URL,
						{
							method: "GET",
							headers: {
								Accept: "application/json",
								Cookie: `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${accessToken}`)}`,
							},
							signal: controller.signal,
						},
						windowsFromUsageSummary
					)
				: Promise.resolve({ ok: false, status: 0, windows: [] } satisfies FetchWindowsResult);

			const [period, legacy, summary] = await Promise.all([
				periodPromise,
				legacyPromise,
				summaryPromise,
			]);
			clear();

			// Prefer dashboard period rails, then usage-summary, then legacy %.
			const windows =
				period.windows.length > 0
					? period.windows
					: summary.windows.length > 0
						? summary.windows
						: legacy.windows;
			if (windows.length > 0) {
				return this.snapshot({ windows });
			}

			const statuses = [period.status, legacy.status, summary.status];
			if (statuses.includes(401)) {
				return this.emptySnapshot(httpError(401));
			}
			const httpFail = statuses.find((status) => status >= 400);
			if (httpFail !== undefined) {
				return this.emptySnapshot(httpError(httpFail));
			}

			return this.emptySnapshot(apiError("Invalid Cursor usage response"));
		} catch {
			clear();
			return this.emptySnapshot(fetchFailed());
		}
	}
}
