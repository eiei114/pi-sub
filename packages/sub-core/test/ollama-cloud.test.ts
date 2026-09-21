import test from "node:test";
import assert from "node:assert/strict";
import { OllamaCloudProvider } from "../src/providers/impl/ollama-cloud.js";
import { createDeps, createJsonResponse, getAuthPath } from "./helpers.js";
import { OLLAMA_USAGE_URL } from "../src/config.js";
import type { UsageSnapshot } from "../src/types.js";

const API_KEY = "ollama-test-key";

function withAuth(files: Map<string, string>, home: string, key = API_KEY): void {
	files.set(
		getAuthPath(home),
		JSON.stringify({ "ollama-cloud": { type: "api_key", access: key } })
	);
}

function usagePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		limits: {
			session: { usage: 0.25, models: [{ name: "gpt-oss:120b", request_count: 10 }] },
			weekly: { usage: 0.5, models: [{ name: "gpt-oss:120b", request_count: 20 }] },
			monthly: { usage: 0.1 },
		},
		activity: {
			cost: "1.23456",
			period: {
				type: "last_4_weeks",
				starting_at: "2026-08-24T00:00:00Z",
				ending_at: "2099-09-20T10:04:44Z",
			},
		},
		...overrides,
	};
}

function windowsOf(usage: UsageSnapshot) {
	assert.equal(usage.error, undefined, `Unexpected error: ${usage.error?.message}`);
	return usage.windows;
}

test("ollama-cloud reads the api key from pi auth.json", async () => {
	const provider = new OllamaCloudProvider();
	let authorization: string | undefined;
	let url: string | undefined;

	const { deps, files } = createDeps({
		fetch: async (u, init) => {
			url = String(u);
			authorization = (init as { headers?: { Authorization?: string } })?.headers?.Authorization;
			return createJsonResponse(usagePayload());
		},
	});
	withAuth(files, deps.homedir());

	await provider.fetchUsage(deps);
	assert.equal(url, OLLAMA_USAGE_URL);
	assert.equal(authorization, `Bearer ${API_KEY}`);
});

test("ollama-cloud prefers OLLAMA_API_KEY over auth.json", async () => {
	const provider = new OllamaCloudProvider();
	let authorization: string | undefined;

	const { deps, files } = createDeps({
		env: { OLLAMA_API_KEY: "env-key" },
		fetch: async (_u, init) => {
			authorization = (init as { headers?: { Authorization?: string } })?.headers?.Authorization;
			return createJsonResponse(usagePayload());
		},
	});
	withAuth(files, deps.homedir());

	await provider.fetchUsage(deps);
	assert.equal(authorization, "Bearer env-key");
});

test("ollama-cloud reports missing credentials", async () => {
	const provider = new OllamaCloudProvider();
	const { deps } = createDeps({
		fetch: async () => createJsonResponse(usagePayload()),
	});

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "NO_CREDENTIALS");
});

test("ollama-cloud maps session/weekly/monthly fractions to windows", async () => {
	const provider = new OllamaCloudProvider();
	const { deps, files } = createDeps({
		fetch: async () => createJsonResponse(usagePayload()),
	});
	withAuth(files, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	const windows = windowsOf(usage);
	assert.deepEqual(
		windows.map((w) => [w.label, w.usedPercent]),
		[
			["Session", 25],
			["Week", 50],
			["Month", 10],
		]
	);
	assert.equal(usage.requestsSummary, "Cost: $1.23456");
	assert.equal(windows[2].resetAt, "2099-09-20T10:04:44.000Z");
	assert.ok(windows[2].resetDescription);
});

test("ollama-cloud reports only the windows the account has", async () => {
	const provider = new OllamaCloudProvider();
	const { deps, files } = createDeps({
		fetch: async () =>
			createJsonResponse({ limits: { monthly: { usage: 0.75 } } }),
	});
	withAuth(files, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	const windows = windowsOf(usage);
	assert.equal(windows.length, 1);
	assert.equal(windows[0].label, "Month");
	assert.equal(windows[0].usedPercent, 75);
});

test("ollama-cloud errors when no window has a usable usage fraction", async () => {
	const provider = new OllamaCloudProvider();
	const { deps, files } = createDeps({
		fetch: async () => createJsonResponse({ limits: {} }),
	});
	withAuth(files, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "API_ERROR");
});

test("ollama-cloud surfaces http errors", async () => {
	const provider = new OllamaCloudProvider();
	const { deps, files } = createDeps({
		fetch: async () => createJsonResponse({}, { ok: false, status: 401 }),
	});
	withAuth(files, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "HTTP_ERROR");
});

test("ollama-cloud surfaces network failures", async () => {
	const provider = new OllamaCloudProvider();
	const { deps, files } = createDeps({
		fetch: async () => {
			throw new Error("connection refused");
		},
	});
	withAuth(files, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "FETCH_FAILED");
});
