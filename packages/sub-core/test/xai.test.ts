import test from "node:test";
import assert from "node:assert/strict";
import { XaiProvider, parseXaiUsageWindow } from "../src/providers/impl/xai.js";
import { createDeps, createJsonResponse, getAuthPath } from "./helpers.js";
import { XAI_BILLING_URL, XAI_CLI_CLIENT_MODE, XAI_CLI_CLIENT_VERSION } from "../src/config.js";
import type { UsageSnapshot } from "../src/types.js";

const OAUTH_ENTRY = { type: "oauth", access: "file-oauth-token", refresh: "r", expires: 1 };

function withAuth(files: Map<string, string>, payload: Record<string, unknown>, home: string): void {
	files.set(getAuthPath(home), JSON.stringify(payload));
}

/** Weekly payload in the shape observed on the live endpoint (values are synthetic). */
function weeklyPayload(percent: number, end = "2099-01-08T09:02:50.979085+00:00") {
	return {
		config: {
			creditUsagePercent: percent,
			currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end },
		},
	};
}

function onlyWindow(usage: UsageSnapshot) {
	assert.equal(usage.error, undefined, `Unexpected error: ${usage.error?.message}`);
	assert.equal(usage.windows.length, 1);
	return usage.windows[0];
}

test("xai does not turn non-ISO reset strings into plausible dates", () => {
	for (const end of ["1", "yesterday", "2026-01-01", "not-a-date"]) {
		const window = parseXaiUsageWindow(weeklyPayload(12, end));
		assert.equal(window?.usedPercent, 12);
		assert.equal(window?.resetAt, undefined);
	}
});

test("xai rejects command-valued or multiline OAuth strings without fetching", async () => {
	for (const access of ["!secret-command", "token\r\nInjected: value"]) {
		const { deps } = createDeps({
			env: { XAI_OAUTH_TOKEN: access },
			fetch: async () => assert.fail("invalid credential must not be sent"),
		});
		assert.equal((await new XaiProvider().fetchUsage(deps)).error?.code, "NO_CREDENTIALS");
	}
});

test("xai requests the billing endpoint with the pinned CLI headers", async () => {
	const provider = new XaiProvider();
	let requestUrl: string | undefined;
	let requestInit: any;

	const { deps, files } = createDeps({
		fetch: async (url, init) => {
			requestUrl = String(url);
			requestInit = init;
			return createJsonResponse(weeklyPayload(12)) as any;
		},
	});
	withAuth(files, { xai: OAUTH_ENTRY }, deps.homedir());

	const usage = await provider.fetchUsage(deps);

	assert.equal(requestUrl, XAI_BILLING_URL);
	assert.equal(requestInit.method, "GET");
	assert.equal(requestInit.redirect, "error");
	assert.equal(requestInit.headers.Authorization, "Bearer file-oauth-token");
	assert.equal(requestInit.headers.Accept, "application/json");
	assert.equal(requestInit.headers["x-grok-client-mode"], XAI_CLI_CLIENT_MODE);
	assert.equal(requestInit.headers["x-grok-client-version"], XAI_CLI_CLIENT_VERSION);
	assert.equal(XAI_CLI_CLIENT_VERSION, "1.0.4");
	assert.equal(usage.provider, "xai");
	assert.match(usage.displayName, /xAI \(Grok\)/);
});

test("xai prefers the XAI_OAUTH_TOKEN override over auth.json", async () => {
	const provider = new XaiProvider();
	let authorization: string | undefined;

	const { deps, files } = createDeps({
		env: { XAI_OAUTH_TOKEN: "env-oauth-token" },
		fetch: async (_url, init) => {
			authorization = (init as any)?.headers?.Authorization;
			return createJsonResponse(weeklyPayload(5)) as any;
		},
	});
	withAuth(files, { xai: OAUTH_ENTRY }, deps.homedir());

	await provider.fetchUsage(deps);
	assert.equal(authorization, "Bearer env-oauth-token");
});

test("xai parses the weekly subscription window", async () => {
	const provider = new XaiProvider();
	const end = "2099-01-08T09:02:50.979085+00:00";
	const { deps, files } = createDeps({
		fetch: async () => createJsonResponse(weeklyPayload(42.5, end)) as any,
	});
	withAuth(files, { xai: OAUTH_ENTRY }, deps.homedir());

	const window = onlyWindow(await provider.fetchUsage(deps));
	assert.equal(window.label, "Week");
	assert.equal(window.usedPercent, 42.5);
	assert.equal(window.resetAt, new Date(end).toISOString());
	assert.ok(window.resetDescription);
});

test("xai parses the snake_case monthly subscription window", async () => {
	const provider = new XaiProvider();
	const end = "2099-02-01T00:00:00+00:00";
	const { deps, files } = createDeps({
		fetch: async () =>
			createJsonResponse({
				config: {
					credit_usage_percent: 7,
					current_period: { type: "USAGE_PERIOD_TYPE_MONTHLY", end },
				},
			}) as any,
	});
	withAuth(files, { xai: OAUTH_ENTRY }, deps.homedir());

	const window = onlyWindow(await provider.fetchUsage(deps));
	assert.equal(window.label, "Month");
	assert.equal(window.usedPercent, 7);
	assert.equal(window.resetAt, new Date(end).toISOString());
});

test("xai falls back to a neutral label for unknown or missing period types", async () => {
	const provider = new XaiProvider();

	for (const config of [
		{ creditUsagePercent: 3, currentPeriod: { type: "USAGE_PERIOD_TYPE_DAILY" } },
		{ creditUsagePercent: 3, currentPeriod: { type: 5 } },
		{ creditUsagePercent: 3 },
	]) {
		const { deps, files } = createDeps({
			fetch: async () => createJsonResponse({ config }) as any,
		});
		withAuth(files, { xai: OAUTH_ENTRY }, deps.homedir());

		const window = onlyWindow(await provider.fetchUsage(deps));
		assert.equal(window.label, "Usage");
		assert.equal(window.usedPercent, 3);
		assert.equal(window.resetAt, undefined);
		assert.equal(window.resetDescription, undefined);
	}
});

test("xai keeps an explicit zero percent as real usage data", async () => {
	const provider = new XaiProvider();
	const { deps, files } = createDeps({
		fetch: async () => createJsonResponse(weeklyPayload(0)) as any,
	});
	withAuth(files, { xai: OAUTH_ENTRY }, deps.homedir());

	const window = onlyWindow(await provider.fetchUsage(deps));
	assert.equal(window.usedPercent, 0);
	assert.equal(window.label, "Week");
});

test("xai clamps a percentage above 100", async () => {
	const provider = new XaiProvider();
	const { deps, files } = createDeps({
		fetch: async () => createJsonResponse(weeklyPayload(140)) as any,
	});
	withAuth(files, { xai: OAUTH_ENTRY }, deps.homedir());

	assert.equal(onlyWindow(await provider.fetchUsage(deps)).usedPercent, 100);
});

test("xai treats an unusable percentage as an error, never as zero usage", async () => {
	const provider = new XaiProvider();

	const invalidConfigs: unknown[] = [
		{ currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" } }, // missing percent
		{ creditUsagePercent: null },
		{ creditUsagePercent: "42" },
		{ creditUsagePercent: Number.NaN },
		{ creditUsagePercent: Number.POSITIVE_INFINITY },
		{ creditUsagePercent: -1 },
	];

	for (const config of invalidConfigs) {
		const { deps, files } = createDeps({
			fetch: async () => createJsonResponse({ config }) as any,
		});
		withAuth(files, { xai: OAUTH_ENTRY }, deps.homedir());

		const usage = await provider.fetchUsage(deps);
		assert.equal(usage.windows.length, 0, `Expected no window for ${JSON.stringify(config)}`);
		assert.equal(usage.error?.code, "API_ERROR");
		assert.equal(usage.error?.message, "Invalid xAI usage response");
	}
});

test("xai rejects malformed payloads including null, arrays and wrong types", async () => {
	const provider = new XaiProvider();

	const payloads: unknown[] = [
		null,
		[],
		[{ config: { creditUsagePercent: 10 } }],
		"config",
		42,
		{},
		{ config: null },
		{ config: [] },
		{ config: "creditUsagePercent" },
		{ config: { creditUsagePercent: 10, currentPeriod: "week" } },
	];

	for (const payload of payloads) {
		const { deps, files } = createDeps({
			fetch: async () => createJsonResponse(payload) as any,
		});
		withAuth(files, { xai: OAUTH_ENTRY }, deps.homedir());

		const usage = await provider.fetchUsage(deps);
		if (
			payload
			&& typeof payload === "object"
			&& !Array.isArray(payload)
			&& (payload as any).config?.creditUsagePercent === 10
		) {
			// A wrong-typed period must not discard a valid percentage.
			const window = onlyWindow(usage);
			assert.equal(window.label, "Usage");
			assert.equal(window.usedPercent, 10);
			continue;
		}
		assert.equal(usage.windows.length, 0, `Expected no window for ${JSON.stringify(payload)}`);
		assert.equal(usage.error?.code, "API_ERROR");
		assert.equal(usage.error?.message, "Invalid xAI usage response");
	}
});

test("xai does not guess quota from legacy cent fields", async () => {
	const provider = new XaiProvider();
	const { deps, files } = createDeps({
		fetch: async () =>
			createJsonResponse({
				config: {
					used: { val: 1234 },
					monthlyLimit: { val: 5000 },
					billingPeriodEnd: "2099-03-01T00:00:00+00:00",
				},
			}) as any,
	});
	withAuth(files, { xai: OAUTH_ENTRY }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.windows.length, 0);
	assert.equal(usage.error?.code, "API_ERROR");
	assert.equal(usage.error?.message, "Invalid xAI usage response");
});

test("xai rejects invalid JSON bodies", async () => {
	const provider = new XaiProvider();
	const { deps, files } = createDeps({
		fetch: async () =>
			({
				ok: true,
				status: 200,
				json: async () => {
					throw new Error("secret-token leaked in body");
				},
			}) as any,
	});
	withAuth(files, { xai: OAUTH_ENTRY }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.message, "Invalid xAI usage response");
});

test("xai reports http status only and never the response body", async () => {
	const provider = new XaiProvider();

	for (const status of [401, 403, 426, 500]) {
		const { deps, files } = createDeps({
			fetch: async () =>
				({
					ok: false,
					status,
					json: async () => ({
						error: "account 12345 over quota",
						token: "file-oauth-token",
					}),
				}) as any,
		});
		withAuth(files, { xai: OAUTH_ENTRY }, deps.homedir());

		const usage = await provider.fetchUsage(deps);
		assert.equal(usage.windows.length, 0);
		assert.equal(usage.error?.code, "HTTP_ERROR");
		assert.equal(usage.error?.httpStatus, status);
		assert.equal(usage.error?.message, `HTTP ${status}`);
		const serialized = JSON.stringify(usage);
		assert.ok(!serialized.includes("file-oauth-token"));
		assert.ok(!serialized.includes("12345"));
		assert.ok(!serialized.includes("over quota"));
	}
});

test("xai soft-fails when the request throws", async () => {
	const provider = new XaiProvider();
	const { deps, files } = createDeps({
		fetch: async () => {
			throw new Error("redirect to https://evil.example with file-oauth-token");
		},
	});
	withAuth(files, { xai: OAUTH_ENTRY }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "FETCH_FAILED");
	assert.equal(usage.error?.message, "Fetch failed");
	assert.ok(!JSON.stringify(usage).includes("file-oauth-token"));
});

test("xai makes no request without an OAuth credential", async () => {
	const provider = new XaiProvider();
	let calls = 0;

	const { deps } = createDeps({
		fetch: async () => {
			calls += 1;
			return createJsonResponse(weeklyPayload(1)) as any;
		},
	});

	assert.equal(provider.hasCredentials(deps), false);
	const usage = await provider.fetchUsage(deps);
	assert.equal(calls, 0);
	assert.equal(usage.error?.code, "NO_CREDENTIALS");
	assert.equal(usage.windows.length, 0);
});

test("xai never falls back to API keys or non-oauth auth entries", async () => {
	const provider = new XaiProvider();

	const cases: Array<{ env?: NodeJS.ProcessEnv; auth: Record<string, unknown> }> = [
		{ env: { XAI_API_KEY: "xai-api-key" }, auth: {} },
		{ auth: { xai: { type: "api_key", key: "xai-api-key" } } },
		{ auth: { xai: { type: "api", access: "not-oauth" } } },
		{ auth: { xai: { access: "missing-type" } } },
		{ auth: { xai: { type: "oauth", access: "   " } } },
		{ auth: { xai: { type: "oauth" } } },
		{ auth: { xai: "raw-string-token" } },
		{ auth: { xai: null } },
	];

	for (const entry of cases) {
		let calls = 0;
		const { deps, files } = createDeps({
			env: entry.env,
			fetch: async () => {
				calls += 1;
				return createJsonResponse(weeklyPayload(1)) as any;
			},
		});
		withAuth(files, entry.auth, deps.homedir());

		assert.equal(provider.hasCredentials(deps), false, JSON.stringify(entry));
		const usage = await provider.fetchUsage(deps);
		assert.equal(calls, 0, `Expected no request for ${JSON.stringify(entry)}`);
		assert.equal(usage.error?.code, "NO_CREDENTIALS");
	}
});

test("xai ignores other providers' credentials", async () => {
	const provider = new XaiProvider();
	let calls = 0;

	const { deps, files } = createDeps({
		env: { ZAI_API_KEY: "zai-key", ANTHROPIC_OAUTH_TOKEN: "anthropic-token" },
		fetch: async () => {
			calls += 1;
			return createJsonResponse(weeklyPayload(1)) as any;
		},
	});
	withAuth(
		files,
		{
			anthropic: { type: "oauth", access: "anthropic-token" },
			"z-ai": { type: "oauth", access: "zai-token" },
			zai: { access: "zai-token" },
		},
		deps.homedir(),
	);

	assert.equal(provider.hasCredentials(deps), false);
	const usage = await provider.fetchUsage(deps);
	assert.equal(calls, 0);
	assert.equal(usage.error?.code, "NO_CREDENTIALS");
});

test("xai tolerates a corrupt auth.json", async () => {
	const provider = new XaiProvider();
	const { deps, files } = createDeps({
		fetch: async () => createJsonResponse(weeklyPayload(1)) as any,
	});
	files.set(getAuthPath(deps.homedir()), "{ not json");

	assert.equal(provider.hasCredentials(deps), false);
	assert.equal((await provider.fetchUsage(deps)).error?.code, "NO_CREDENTIALS");
});

test("xai accepts a valid stored OAuth entry", async () => {
	const provider = new XaiProvider();
	const { deps, files } = createDeps({
		fetch: async () => createJsonResponse(weeklyPayload(1)) as any,
	});
	withAuth(files, { xai: OAUTH_ENTRY }, deps.homedir());

	assert.equal(provider.hasCredentials(deps), true);
});
