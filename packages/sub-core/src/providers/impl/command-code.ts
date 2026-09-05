/**
 * Command Code usage provider (unofficial API)
 */

import * as path from "node:path";
import type { Dependencies, RateWindow, UsageSnapshot } from "../../types.js";
import { BaseProvider } from "../../provider.js";
import { noCredentials, fetchFailed, httpError, apiError } from "../../errors.js";
import { formatReset, createTimeoutController } from "../../utils.js";
import { API_TIMEOUT_MS, COMMAND_CODE_CREDITS_URL, COMMAND_CODE_WHOAMI_URL } from "../../config.js";

interface CommandCodeWindowLimit {
	used?: number;
	cap?: number;
	resetAt?: number;
}

interface CommandCodeCredits {
	credits?: {
		monthlyCredits?: number;
		purchasedCredits?: number;
		freeCredits?: number;
	};
	windowLimits?: {
		fiveHour?: CommandCodeWindowLimit;
		weekly?: CommandCodeWindowLimit;
	};
}

function normalizeApiKey(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

function extractKeyFromAuthObject(entry: unknown): string | undefined {
	if (typeof entry === "string") return normalizeApiKey(entry);
	if (!isRecord(entry)) return undefined;
	return (
		normalizeApiKey(entry.apiKey)
		?? normalizeApiKey(entry.key)
		?? normalizeApiKey(entry.access)
		?? normalizeApiKey(entry.token)
	);
}

/**
 * Auth order: env → ~/.commandcode/auth.json → Pi auth.json → ~/.omp/agent/auth.json.
 * Only the provider-native file may supply an unscoped root apiKey.
 */
function loadCommandCodeApiKey(deps: Dependencies): string | undefined {
	const envKey = normalizeApiKey(
		deps.env.COMMAND_CODE_API_KEY ?? deps.env.COMMANDCODE_API_KEY ?? deps.env.COMMAND_CODE_TOKEN
	);
	if (envKey) return envKey;

	const nativeAuthPath = path.join(deps.homedir(), ".commandcode", "auth.json");
	const candidates = [
		nativeAuthPath,
		path.join(deps.homedir(), ".pi", "agent", "auth.json"),
		path.join(deps.homedir(), ".omp", "agent", "auth.json"),
	];

	for (const authPath of candidates) {
		try {
			if (!deps.fileExists(authPath)) continue;
			const auth = JSON.parse(deps.readFile(authPath) ?? "{}") as Record<string, unknown>;
			if (authPath === nativeAuthPath) {
				const fromRoot = extractKeyFromAuthObject(auth.apiKey);
				if (fromRoot) return fromRoot;
			}
			const fromCommandCode =
				extractKeyFromAuthObject(auth["command-code"])
				?? extractKeyFromAuthObject(auth.commandcode)
				?? extractKeyFromAuthObject(auth["command_code"]);
			if (fromCommandCode) return fromCommandCode;
		} catch {
			// try next path
		}
	}

	return undefined;
}

function parseOrgId(payload: unknown): string | null | undefined {
	if (!isRecord(payload)) return undefined;
	const org = payload.org;
	if (!isRecord(org)) return null;
	return typeof org.id === "string" && org.id.trim() ? org.id.trim() : null;
}

function pushLimitWindow(
	windows: RateWindow[],
	label: string,
	limit: CommandCodeWindowLimit | undefined
): void {
	const used = toFiniteNumber(limit?.used);
	const cap = toFiniteNumber(limit?.cap);
	if (used === undefined || cap === undefined || cap <= 0) return;
	const resetRaw = toFiniteNumber(limit?.resetAt);
	const resetDate =
		resetRaw !== undefined
			? new Date(resetRaw < 1_000_000_000_000 ? resetRaw * 1000 : resetRaw)
			: undefined;
	const validReset = resetDate && !Number.isNaN(resetDate.getTime()) ? resetDate : undefined;
	windows.push({
		label,
		usedPercent: clampPercent((used / cap) * 100),
		resetDescription: validReset ? formatReset(validReset) : undefined,
		resetAt: validReset?.toISOString(),
	});
}

function formatCreditParts(credits: CommandCodeCredits["credits"]): string | undefined {
	if (!credits) return undefined;
	const parts: string[] = [];
	const purchased = toFiniteNumber(credits.purchasedCredits);
	const free = toFiniteNumber(credits.freeCredits);
	if (purchased !== undefined) parts.push(`purchased ${purchased}`);
	if (free !== undefined) parts.push(`free ${free}`);
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

export class CommandCodeProvider extends BaseProvider {
	readonly name = "command-code" as const;
	readonly displayName = "Command Code";

	hasCredentials(deps: Dependencies): boolean {
		return Boolean(loadCommandCodeApiKey(deps));
	}

	async fetchUsage(deps: Dependencies): Promise<UsageSnapshot> {
		const apiKey = loadCommandCodeApiKey(deps);
		if (!apiKey) {
			return this.emptySnapshot(noCredentials());
		}

		const { controller, clear } = createTimeoutController(API_TIMEOUT_MS);
		const headers = {
			Authorization: `Bearer ${apiKey}`,
			Accept: "application/json",
		};

		try {
			const whoamiRes = await deps.fetch(COMMAND_CODE_WHOAMI_URL, {
				method: "GET",
				headers,
				signal: controller.signal,
			});
			if (!whoamiRes.ok) {
				clear();
				return this.emptySnapshot(httpError(whoamiRes.status));
			}

			let orgId: string | null | undefined;
			try {
				orgId = parseOrgId(await whoamiRes.json());
			} catch {
				clear();
				return this.emptySnapshot(apiError("Invalid Command Code whoami response"));
			}
			if (orgId === undefined) {
				clear();
				return this.emptySnapshot(apiError("Command Code account could not be determined"));
			}

			const creditsUrl = orgId
				? `${COMMAND_CODE_CREDITS_URL}?orgId=${encodeURIComponent(orgId)}`
				: COMMAND_CODE_CREDITS_URL;
			const creditsRes = await deps.fetch(creditsUrl, {
				method: "GET",
				headers,
				signal: controller.signal,
			});
			clear();

			if (!creditsRes.ok) {
				return this.emptySnapshot(httpError(creditsRes.status));
			}

			let payload: CommandCodeCredits;
			try {
				payload = (await creditsRes.json()) as CommandCodeCredits;
			} catch {
				return this.emptySnapshot(apiError("Invalid Command Code credits response"));
			}

			const windows: RateWindow[] = [];
			pushLimitWindow(windows, "5h", payload.windowLimits?.fiveHour);
			pushLimitWindow(windows, "Week", payload.windowLimits?.weekly);

			const monthly = toFiniteNumber(payload.credits?.monthlyCredits);
			const creditParts = formatCreditParts(payload.credits);

			if (windows.length === 0 && monthly === undefined && !creditParts) {
				return this.emptySnapshot(apiError("Invalid Command Code usage response"));
			}

			return this.snapshot({
				windows,
				creditRemaining: monthly,
				requestsSummary: creditParts,
			});
		} catch {
			clear();
			return this.emptySnapshot(fetchFailed());
		}
	}
}
