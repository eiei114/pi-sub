/**
 * Devin (Cognition) subscription quota provider.
 *
 * Quota is scoped to an organization, so this lists the organizations the
 * session token can see, then asks each one for its quota and stops at the first
 * organization that answers. The credential is the long-lived
 * `devin-session-token$…` value the `devin` model provider stores in pi's
 * `auth.json`; the same value authenticates the web-app API.
 *
 * `daily_percentage` / `weekly_percentage` are read as the *used* share. That
 * direction is inferred, not documented: a freshly allocated plan reports `0`,
 * which only reads as "nothing used yet". An account whose numbers run the other
 * way would need the opposite reading.
 *
 * Both endpoints are unofficial and may change without notice.
 */

import * as path from "node:path";
import type { Dependencies, RateWindow, UsageSnapshot } from "../../types.js";
import { BaseProvider } from "../../provider.js";
import { noCredentials, fetchFailed, httpError, apiError } from "../../errors.js";
import { formatReset, createTimeoutController } from "../../utils.js";
import { API_TIMEOUT_MS, DEVIN_ORGANIZATIONS_URL, devinQuotaUrl } from "../../config.js";

/** Read the session token pi stored for the `devin` provider. */
function loadDevinSessionToken(deps: Dependencies): string | undefined {
	const authPath = path.join(deps.homedir(), ".pi", "agent", "auth.json");
	try {
		if (!deps.fileExists(authPath)) return undefined;
		const auth = JSON.parse(deps.readFile(authPath) ?? "{}") as {
			devin?: { access?: string; key?: string };
		};
		return auth.devin?.access || auth.devin?.key;
	} catch {
		return undefined;
	}
}

interface DevinOrganization {
	org_id?: string;
	is_primary_org?: boolean;
}

interface DevinQuota {
	daily_percentage?: unknown;
	weekly_percentage?: unknown;
	daily_reset_at?: unknown;
	weekly_reset_at?: unknown;
}

function asPercent(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Absolute reset instants only; a non-ISO string is dropped rather than guessed. */
function resetFields(value: unknown): Pick<RateWindow, "resetAt" | "resetDescription"> {
	if (typeof value !== "string" || !value) return {};
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return {};
	return { resetAt: date.toISOString(), resetDescription: formatReset(date) };
}

/** Map a quota payload onto the windows the bar renders. */
export function buildDevinWindows(quota: DevinQuota): RateWindow[] {
	const windows: RateWindow[] = [];

	const daily = asPercent(quota.daily_percentage);
	if (daily !== undefined) {
		windows.push({ label: "Day", usedPercent: daily, ...resetFields(quota.daily_reset_at) });
	}

	const weekly = asPercent(quota.weekly_percentage);
	if (weekly !== undefined) {
		windows.push({ label: "Week", usedPercent: weekly, ...resetFields(quota.weekly_reset_at) });
	}

	return windows;
}

export class DevinProvider extends BaseProvider {
	readonly name = "devin" as const;
	readonly displayName = "Devin";

	hasCredentials(deps: Dependencies): boolean {
		return Boolean(loadDevinSessionToken(deps));
	}

	async fetchUsage(deps: Dependencies): Promise<UsageSnapshot> {
		const token = loadDevinSessionToken(deps);
		if (!token) {
			return this.emptySnapshot(noCredentials());
		}

		const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
		const { controller, clear } = createTimeoutController(API_TIMEOUT_MS);

		try {
			const orgRes = await deps.fetch(DEVIN_ORGANIZATIONS_URL, {
				method: "GET",
				headers,
				signal: controller.signal,
			});
			if (!orgRes.ok) {
				return this.emptySnapshot(httpError(orgRes.status));
			}

			const organizations = (await orgRes.json()) as unknown;
			if (!Array.isArray(organizations)) {
				return this.emptySnapshot(apiError("Unexpected organizations payload"));
			}

			// One token can belong to several organizations and can only read the
			// quota of some of them. The primary one is tried first; an unreadable
			// organization is skipped rather than reported, because a readable one
			// further down the list is the real answer.
			const ordered = [...(organizations as DevinOrganization[])].sort(
				(a, b) => Number(Boolean(b.is_primary_org)) - Number(Boolean(a.is_primary_org)),
			);
			const orgIds = ordered
				.map((organization) => organization.org_id)
				.filter((orgId): orgId is string => Boolean(orgId));
			if (orgIds.length === 0) {
				return this.emptySnapshot(apiError("No Devin organization for this token"));
			}

			let lastStatus = 0;
			for (const orgId of orgIds) {
				const quotaRes = await deps.fetch(devinQuotaUrl(orgId), {
					method: "GET",
					headers,
					signal: controller.signal,
				});
				lastStatus = quotaRes.status;
				if (!quotaRes.ok) continue;
				const quota = (await quotaRes.json()) as DevinQuota;
				return this.snapshot({ windows: buildDevinWindows(quota) });
			}

			return this.emptySnapshot(httpError(lastStatus));
		} catch {
			return this.emptySnapshot(fetchFailed());
		} finally {
			clear();
		}
	}
}
