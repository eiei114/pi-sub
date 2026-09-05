import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { OpenRouterProvider } from "../src/providers/impl/openrouter.js";
import { createDeps, createJsonResponse, getAuthPath } from "./helpers.js";
import type { UsageSnapshot } from "../src/types.js";
import { API_TIMEOUT_MS, OPENROUTER_CREDITS_URL, OPENROUTER_KEY_URL } from "../src/config.js";
import { creditsUsedPercent, keyLimitUsedPercent, parseCreditsResponse, parseKeyResponse } from "../src/providers/impl/openrouter-parse.js";

function withAuth(files: Map<string, string>, payload: Record<string, unknown>, home: string): void {
	files.set(getAuthPath(home), JSON.stringify(payload));
}

interface OpenRouterCall {
	url: string;
	method?: string;
	redirect?: string;
	authorization?: string;
	signal?: AbortSignal;
}

/**
 * Route the two OpenRouter endpoints separately. `/key` is authoritative and
 * `/credits` is optional, so tests must be able to fail them independently.
 * The default `/credits` handler is the 403 an ordinary inference key gets.
 */
function createOpenRouterFetch(
	handlers: { key: () => unknown; credits?: () => unknown },
	calls: OpenRouterCall[] = [],
): any {
	return async (url: unknown, init: any) => {
		const href = String(url);
		calls.push({
			url: href,
			method: init?.method,
			redirect: init?.redirect,
			authorization: init?.headers?.Authorization,
			signal: init?.signal,
		});
		if (href === OPENROUTER_KEY_URL) return handlers.key();
		if (href === OPENROUTER_CREDITS_URL) {
			const credits = handlers.credits ?? (() => createJsonResponse({}, { ok: false, status: 403 }));
			return credits();
		}
		throw new Error(`unexpected OpenRouter url: ${href}`);
	};
}

function findWindow(usage: UsageSnapshot, label: string) {
	return usage.windows.find((window) => window.label === label);
}

test("openrouter reads token from OPENROUTER_API_KEY env var", async () => {
	const provider = new OpenRouterProvider();
	const calls: OpenRouterCall[] = [];

	const { deps } = createDeps({
		env: { OPENROUTER_API_KEY: "or-token" },
		fetch: createOpenRouterFetch({ key: () => createJsonResponse({ data: { limit: null, usage: 2 } }) }, calls),
	});

	await provider.fetchUsage(deps);
	assert.equal(calls[0]?.url, OPENROUTER_KEY_URL);
	assert.equal(calls[0]?.authorization, "Bearer or-token");
});

test("openrouter falls back to OPENROUTER_KEY when OPENROUTER_API_KEY is blank", async () => {
	const provider = new OpenRouterProvider();
	const calls: OpenRouterCall[] = [];

	const { deps } = createDeps({
		env: { OPENROUTER_API_KEY: "   ", OPENROUTER_KEY: "fallback-token" },
		fetch: createOpenRouterFetch({ key: () => createJsonResponse({ data: { limit: null, usage: 0 } }) }, calls),
	});

	assert.equal(provider.hasCredentials(deps), true);
	await provider.fetchUsage(deps);
	assert.equal(calls[0]?.authorization, "Bearer fallback-token");
});

test("openrouter env token overrides auth.json", async () => {
	const provider = new OpenRouterProvider();
	const calls: OpenRouterCall[] = [];

	const { deps, files } = createDeps({
		env: { OPENROUTER_API_KEY: "env-token" },
		fetch: createOpenRouterFetch({ key: () => createJsonResponse({ data: { limit: null, usage: 1 } }) }, calls),
	});
	withAuth(files, { openrouter: { access: "file-token" } }, deps.homedir());

	await provider.fetchUsage(deps);
	assert.equal(calls[0]?.authorization, "Bearer env-token");
});

test("openrouter ignores auth values that would need a command to resolve", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({ key: () => createJsonResponse({ data: { usage: 1 } }) }),
	});
	withAuth(files, { openrouter: { access: "!op read op://vault/openrouter" } }, deps.homedir());

	assert.equal(provider.hasCredentials(deps), false);
	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "NO_CREDENTIALS");
});

test("openrouter requests both fixed endpoints with GET and the same bearer token", async () => {
	const provider = new OpenRouterProvider();
	const calls: OpenRouterCall[] = [];
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch(
			{
				key: () => createJsonResponse({ data: { limit: 10, limit_remaining: 4, usage: 6 } }),
				credits: () => createJsonResponse({ data: { total_credits: 20, total_usage: 5 } }),
			},
			calls,
		),
	});
	withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

	await provider.fetchUsage(deps);

	assert.deepEqual(
		calls.map((call) => call.url),
		[OPENROUTER_KEY_URL, OPENROUTER_CREDITS_URL],
	);
	for (const call of calls) {
		assert.equal(call.method, "GET");
		assert.equal(call.redirect, "error");
		assert.equal(call.authorization, "Bearer token");
		assert.ok(call.signal instanceof AbortSignal);
		assert.equal(call.signal?.aborted, false);
	}
});

test("openrouter keeps key data when the account credits endpoint is forbidden", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({
			key: () => createJsonResponse({ data: { limit: 10, limit_remaining: 2.5, usage: 7.5 } }),
			credits: () => createJsonResponse({}, { ok: false, status: 403 }),
		}),
	});
	withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error, undefined);
	assert.equal(findWindow(usage, "Key limit")?.usedPercent, 75);
	assert.equal(usage.keyLimit, 10);
	assert.equal(usage.keyRemaining, 2.5);
	assert.equal(usage.keyUsage, 7.5);
	assert.equal(findWindow(usage, "Credits"), undefined);
	assert.equal(usage.creditTotal, undefined);
	assert.equal(usage.creditUsage, undefined);
	assert.equal(usage.creditRemaining, undefined);
	assert.equal(usage.creditUnavailable, true);
});

test("openrouter keeps key data when the credits request throws", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({
			key: () => createJsonResponse({ data: { limit: null, usage: 3 } }),
			credits: () => {
				throw new Error("network down");
			},
		}),
	});
	withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error, undefined);
	assert.equal(usage.keyUsage, 3);
	assert.equal(usage.keyLimit, null);
	assert.equal(usage.creditUnavailable, true);
});

test("openrouter reports a capped key and the account wallet separately", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({
			// All-time usage far exceeds the cap: the percent must come from
			// limit_remaining, never from `limit - usage`.
			key: () => createJsonResponse({ data: { limit: 10, limit_remaining: 2.5, usage: 30 } }),
			credits: () => createJsonResponse({ data: { total_credits: 20, total_usage: 5 } }),
		}),
	});
	withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(findWindow(usage, "Key limit")?.usedPercent, 75);
	assert.equal(findWindow(usage, "Credits")?.usedPercent, 25);
	assert.equal(usage.keyLimit, 10);
	assert.equal(usage.keyRemaining, 2.5);
	assert.equal(usage.keyUsage, 30);
	assert.equal(usage.creditTotal, 20);
	assert.equal(usage.creditUsage, 5);
	assert.equal(usage.creditRemaining, 15);
	assert.equal(usage.creditUnavailable, undefined);
});

test("openrouter never turns limit_reset into a reset date", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({
			key: () => createJsonResponse({
				data: { limit: 10, limit_remaining: 5, limit_reset: "monthly", usage: 5 },
			}),
			credits: () => createJsonResponse({ data: { total_credits: 20, total_usage: 5 } }),
		}),
	});
	withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	for (const window of usage.windows) {
		assert.equal(window.resetDescription, undefined);
		assert.equal(window.resetAt, undefined);
	}
});

test("openrouter reports an uncapped key without fabricating a quota", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({
			key: () => createJsonResponse({ data: { limit: null, limit_remaining: null, usage: 4.2 } }),
		}),
	});
	withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error, undefined);
	assert.equal(usage.windows.length, 0);
	assert.equal(usage.keyLimit, null);
	assert.equal(usage.keyRemaining, undefined);
	assert.equal(usage.keyUsage, 4.2);
});

test("openrouter reports an unknown key cap without fabricating a quota", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({ key: () => createJsonResponse({ data: { usage: 5 } }) }),
	});
	withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.windows.length, 0);
	assert.equal(usage.keyLimit, undefined);
	assert.equal(usage.keyUsage, 5);
});

test("openrouter skips the key window when the remaining cap is unknown", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({ key: () => createJsonResponse({ data: { limit: 10, usage: 5 } }) }),
	});
	withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(findWindow(usage, "Key limit"), undefined);
	assert.equal(usage.keyLimit, 10);
	assert.equal(usage.keyRemaining, undefined);
});

test("openrouter treats a zero key cap as exhausted", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({
			key: () => createJsonResponse({ data: { limit: 0, limit_remaining: 0, usage: 0 } }),
		}),
	});
	withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(findWindow(usage, "Key limit")?.usedPercent, 100);
	assert.equal(usage.keyLimit, 0);
});

test("openrouter treats a zero account wallet as exhausted", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({
			key: () => createJsonResponse({ data: { limit: null, usage: 0 } }),
			credits: () => createJsonResponse({ data: { total_credits: 0, total_usage: 0 } }),
		}),
	});
	withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(findWindow(usage, "Credits")?.usedPercent, 100);
	assert.equal(usage.creditTotal, 0);
	assert.equal(usage.creditRemaining, 0);
});

test("openrouter clamps creditRemaining when usage exceeds credits", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({
			key: () => createJsonResponse({ data: { limit: null, usage: 15 } }),
			credits: () => createJsonResponse({ data: { total_credits: 10, total_usage: 15 } }),
		}),
	});
	withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.creditRemaining, 0);
	assert.equal(findWindow(usage, "Credits")?.usedPercent, 100);
});

test("openrouter ignores a partial credits payload instead of reading it as zero", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({
			key: () => createJsonResponse({ data: { limit: null, usage: 1 } }),
			credits: () => createJsonResponse({ data: { total_credits: 20 } }),
		}),
	});
	withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.creditTotal, undefined);
	assert.equal(usage.creditRemaining, undefined);
	assert.equal(usage.creditUnavailable, true);
});

test("openrouter reports http errors and does not fall through to credits", async () => {
	const provider = new OpenRouterProvider();
	const calls: OpenRouterCall[] = [];
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({ key: () => createJsonResponse({}, { ok: false, status: 401 }) }, calls),
	});
	withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "HTTP_ERROR");
	assert.equal(usage.error?.httpStatus, 401);
	assert.deepEqual(calls.map((call) => call.url), [OPENROUTER_KEY_URL]);
});

test("openrouter reports invalid API responses", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({ key: () => createJsonResponse({ data: { total_credits: "10" } }) }),
	});
	withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "API_ERROR");
});

test("openrouter rejects negative and non-numeric key amounts", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({
			key: () => createJsonResponse({ data: { limit: -5, limit_remaining: "2", usage: -1 } }),
		}),
	});
	withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "API_ERROR");
	assert.equal(usage.keyLimit, undefined);
	assert.equal(usage.keyUsage, undefined);
});

test("openrouter reports malformed JSON as a static API error", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({
			key: () => ({
				ok: true,
				status: 200,
				json: async () => {
					throw new SyntaxError("Unexpected token < in secret-token-abc");
				},
			}),
		}),
	});
	withAuth(files, { openrouter: { access: "secret-token-abc" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "API_ERROR");
	assert.equal(usage.error?.message, "Invalid OpenRouter key response");
	assert.ok(!usage.error?.message.includes("secret-token-abc"));
});

test("openrouter reports transport failures without leaking the exception", async () => {
	const provider = new OpenRouterProvider();
	const { deps, files } = createDeps({
		fetch: createOpenRouterFetch({
			key: () => {
				throw new Error("connect ECONNREFUSED with secret-token-abc");
			},
		}),
	});
	withAuth(files, { openrouter: { access: "secret-token-abc" } }, deps.homedir());

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "FETCH_FAILED");
	assert.equal(usage.error?.message, "Fetch failed");
});

test("openrouter reports missing credentials", async () => {
	const provider = new OpenRouterProvider();
	const { deps } = createDeps();

	const usage = await provider.fetchUsage(deps);
	assert.equal(usage.error?.code, "NO_CREDENTIALS");
});

test("openrouter aborts an in-flight request when the timeout fires", async () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		const provider = new OpenRouterProvider();
		const calls: OpenRouterCall[] = [];
		const { deps, files } = createDeps({
			fetch: createOpenRouterFetch(
				{
					key: () => {
						// Fire the shared timeout while the request is still open.
						mock.timers.tick(API_TIMEOUT_MS);
						throw new Error("The operation was aborted");
					},
				},
				calls,
			),
		});
		withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

		const usage = await provider.fetchUsage(deps);
		assert.equal(calls[0]?.signal?.aborted, true);
		assert.equal(usage.error?.code, "FETCH_FAILED");
	} finally {
		mock.timers.reset();
	}
});

test("openrouter clears the timeout once both requests finish", async () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		const provider = new OpenRouterProvider();
		const calls: OpenRouterCall[] = [];
		const { deps, files } = createDeps({
			fetch: createOpenRouterFetch(
				{
					key: () => createJsonResponse({ data: { limit: 10, limit_remaining: 5, usage: 5 } }),
					credits: () => createJsonResponse({ data: { total_credits: 20, total_usage: 5 } }),
				},
				calls,
			),
		});
		withAuth(files, { openrouter: { access: "token" } }, deps.homedir());

		const usage = await provider.fetchUsage(deps);
		assert.equal(usage.error, undefined);

		mock.timers.tick(API_TIMEOUT_MS * 2);
		for (const call of calls) {
			assert.equal(call.signal?.aborted, false);
		}
	} finally {
		mock.timers.reset();
	}
});

test("openrouter key parsing rejects unusable payload shapes", () => {
	assert.equal(parseKeyResponse(null), undefined);
	assert.equal(parseKeyResponse([]), undefined);
	assert.equal(parseKeyResponse("data"), undefined);
	assert.equal(parseKeyResponse({}), undefined);
	assert.equal(parseKeyResponse({ data: null }), undefined);
	assert.equal(parseKeyResponse({ data: [] }), undefined);
	assert.equal(parseKeyResponse({ data: { usage: Number.NaN } }), undefined);
	assert.equal(parseKeyResponse({ data: { usage: Number.POSITIVE_INFINITY } }), undefined);
	assert.equal(parseKeyResponse({ data: { limit: "10" } }), undefined);

	assert.deepEqual(parseKeyResponse({ data: { limit: null, usage: 2 } }), {
		usage: 2,
		limit: null,
		remaining: undefined,
	});
	assert.deepEqual(parseKeyResponse({ data: { limit: 8, limit_remaining: -1, usage: 2 } }), {
		usage: 2,
		limit: 8,
		remaining: undefined,
	});
});

test("openrouter credits parsing treats missing totals as unknown", () => {
	assert.equal(parseCreditsResponse(null), undefined);
	assert.equal(parseCreditsResponse([]), undefined);
	assert.equal(parseCreditsResponse({ data: { total_credits: 5 } }), undefined);
	assert.equal(parseCreditsResponse({ data: { total_credits: 5, total_usage: "1" } }), undefined);
	assert.deepEqual(parseCreditsResponse({ data: { total_credits: 5, total_usage: 1 } }), {
		total: 5,
		usage: 1,
	});
});

test("openrouter percent helpers never report an unknown value as full", () => {
	assert.equal(keyLimitUsedPercent(0, 0), 100);
	assert.equal(keyLimitUsedPercent(0, 5), 100);
	assert.equal(keyLimitUsedPercent(10, undefined), undefined);
	assert.equal(keyLimitUsedPercent(10, 10), 0);
	assert.equal(keyLimitUsedPercent(10, 25), 0);
	assert.equal(creditsUsedPercent(0, 0), 100);
	assert.equal(creditsUsedPercent(10, 20), 100);
});
