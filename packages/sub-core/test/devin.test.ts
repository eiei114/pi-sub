import test from "node:test";
import assert from "node:assert/strict";
import { DevinProvider, buildDevinWindows } from "../src/providers/impl/devin.js";
import { createDeps, createJsonResponse, getAuthPath } from "./helpers.js";
import { DEVIN_ORGANIZATIONS_URL, devinQuotaUrl } from "../src/config.js";
import type { UsageSnapshot } from "../src/types.js";

const SESSION_TOKEN = "devin-session-token$test";

function withAuth(files: Map<string, string>, home: string, token = SESSION_TOKEN): void {
	files.set(
		getAuthPath(home),
		JSON.stringify({ devin: { type: "oauth", access: token, refresh: "", expires: 0 } })
	);
}

function quotaPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		is_quota_plan: true,
		has_quota_allocation: true,
		daily_percentage: 12,
		weekly_percentage: 34,
		daily_reset_at: "2099-09-16T00:00:00-08:00",
		weekly_reset_at: "2099-09-20T00:00:00-08:00",
		overage_balance: 0,
		hide_daily_quota: false,
		...overrides,
	};
}

function windowsOf(usage: UsageSnapshot) {
	assert.equal(usage.error, undefined, `Unexpected error: ${usage.error?.message}`);
	return usage.windows;
}

test("devin reads the session token from pi auth.json", async () => {
	const provider = new DevinProvider();
	let authorization: string | undefined;

	const { deps, files } = createDeps({
		fetch: async (_url, init) => {
			authorization = (init as { headers?: { Authorization?: string } })?.headers?.Authorization;
			return createJsonResponse([]);
		},
	});
	withAuth(files, deps.homedir());

	await provider.fetchUsage(deps);
	assert.equal(authorization, `Bearer ${SESSION_TOKEN}`);
});

test("devin reports missing credentials", async () => {
	const provider = new DevinProvider();
	const { deps } = createDeps({
		fetch: async () => createJsonResponse([]),
	});

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "NO_CREDENTIALS");
});

test("devin parses the daily and weekly windows", async () => {
	const provider = new DevinProvider();
	const { deps, files } = createDeps({
		fetch: async (url) => {
			if (String(url) === DEVIN_ORGANIZATIONS_URL) {
				return createJsonResponse([{ org_id: "org-1", is_primary_org: true }]);
			}
			return createJsonResponse(quotaPayload());
		},
	});
	withAuth(files, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	const windows = windowsOf(usage);
	assert.deepEqual(
		windows.map((window) => window.label),
		["Day", "Week"]
	);
	assert.equal(windows[0]?.usedPercent, 12);
	assert.equal(windows[1]?.usedPercent, 34);
	assert.equal(windows[0]?.resetAt, new Date("2099-09-16T00:00:00-08:00").toISOString());
	assert.ok(windows[0]?.resetDescription);
});

test("devin asks the primary organization first and keeps the readable answer", async () => {
	const provider = new DevinProvider();
	const requested: string[] = [];

	const { deps, files } = createDeps({
		fetch: async (url) => {
			const href = String(url);
			requested.push(href);
			if (href === DEVIN_ORGANIZATIONS_URL) {
				return createJsonResponse([
					{ org_id: "org-member", is_primary_org: false },
					{ org_id: "org-primary", is_primary_org: true },
				]);
			}
			if (href === devinQuotaUrl("org-primary")) {
				return createJsonResponse(quotaPayload({ daily_percentage: 7 }));
			}
			return createJsonResponse({ detail: "Organization not found" }, { ok: false, status: 404 });
		},
	});
	withAuth(files, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	const windows = windowsOf(usage);
	assert.equal(windows[0]?.usedPercent, 7);
	assert.deepEqual(requested.slice(0, 2), [DEVIN_ORGANIZATIONS_URL, devinQuotaUrl("org-primary")]);
	assert.ok(!requested.includes(devinQuotaUrl("org-member")));
});

test("devin falls back to another organization when the first is not readable", async () => {
	const provider = new DevinProvider();
	const requested: string[] = [];

	const { deps, files } = createDeps({
		fetch: async (url) => {
			const href = String(url);
			requested.push(href);
			if (href === DEVIN_ORGANIZATIONS_URL) {
				return createJsonResponse([
					{ org_id: "org-not-mine" },
					{ org_id: "org-mine" },
				]);
			}
			if (href === devinQuotaUrl("org-not-mine")) {
				return createJsonResponse({ detail: "Unauthorized" }, { ok: false, status: 403 });
			}
			return createJsonResponse(quotaPayload({ daily_percentage: 55 }));
		},
	});
	withAuth(files, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	const windows = windowsOf(usage);
	assert.equal(windows[0]?.usedPercent, 55);
	assert.deepEqual(requested, [
		DEVIN_ORGANIZATIONS_URL,
		devinQuotaUrl("org-not-mine"),
		devinQuotaUrl("org-mine"),
	]);
});

test("devin reports the last http status when no organization is readable", async () => {
	const provider = new DevinProvider();
	const { deps, files } = createDeps({
		fetch: async (url) => {
			if (String(url) === DEVIN_ORGANIZATIONS_URL) {
				return createJsonResponse([{ org_id: "org-a" }, { org_id: "org-b" }]);
			}
			return createJsonResponse({ detail: "Unauthorized" }, { ok: false, status: 403 });
		},
	});
	withAuth(files, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "HTTP_ERROR");
	assert.equal(usage.error?.httpStatus, 403);
});

test("devin reports the organizations call failing", async () => {
	const provider = new DevinProvider();
	const { deps, files } = createDeps({
		fetch: async () => createJsonResponse({ detail: "Unauthenticated" }, { ok: false, status: 401 }),
	});
	withAuth(files, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "HTTP_ERROR");
	assert.equal(usage.error?.httpStatus, 401);
});

test("devin rejects a non-array organizations payload", async () => {
	const provider = new DevinProvider();
	const { deps, files } = createDeps({
		fetch: async () => createJsonResponse({ organizations: [] }),
	});
	withAuth(files, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "API_ERROR");
});

test("devin reports a token with no organization", async () => {
	const provider = new DevinProvider();
	const { deps, files } = createDeps({
		fetch: async () => createJsonResponse([{ is_primary_org: true }]),
	});
	withAuth(files, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "API_ERROR");
});

test("devin drops a non-ISO reset string instead of guessing a date", () => {
	const windows = buildDevinWindows({
		daily_percentage: 1,
		daily_reset_at: "tomorrow",
		weekly_percentage: 2,
		weekly_reset_at: "2099-09-20T00:00:00-08:00",
	});

	assert.equal(windows[0]?.resetAt, undefined);
	assert.equal(windows[0]?.resetDescription, undefined);
	assert.ok(windows[1]?.resetAt);
});

test("devin skips percentages that are not finite numbers", () => {
	const windows = buildDevinWindows({
		daily_percentage: "12",
		weekly_percentage: Number.NaN,
	});

	assert.equal(windows.length, 0);
});

test("devin keeps the window that is present when the other is missing", () => {
	const windows = buildDevinWindows({ weekly_percentage: 40 });
	assert.deepEqual(
		windows.map((window) => window.label),
		["Week"]
	);
});
