import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { AnthropicProvider } from "../src/providers/impl/anthropic.js";
import { CopilotProvider } from "../src/providers/impl/copilot.js";
import { CodexProvider } from "../src/providers/impl/codex.js";
import { createDeps, createJsonResponse, getAuthPath } from "./helpers.js";

const targets = [
	{
		name: "anthropic access",
		provider: () => new AnthropicProvider(),
		key: "anthropic",
		field: "access",
		scheme: "Bearer",
		env: "ANTHROPIC_OAUTH_TOKEN",
		legacyPath: [".claude", ".credentials.json"],
		legacy: { claudeAiOauth: { accessToken: "legacy-token" } },
	},
	{
		name: "copilot refresh",
		provider: () => new CopilotProvider(),
		key: "github-copilot",
		field: "refresh",
		scheme: "token",
		env: "COPILOT_GITHUB_TOKEN",
		legacyPath: [".config", "github-copilot", "hosts.json"],
		legacy: { "github.com": { oauth_token: "legacy-token" } },
	},
	{
		name: "copilot access",
		provider: () => new CopilotProvider(),
		key: "github-copilot",
		field: "access",
		scheme: "token",
		env: "COPILOT_GITHUB_TOKEN",
		legacyPath: [".config", "github-copilot", "hosts.json"],
		legacy: { "github.com": { oauth_token: "legacy-token" } },
	},
	{
		name: "codex access",
		provider: () => new CodexProvider(),
		key: "openai-codex",
		field: "access",
		scheme: "Bearer",
		env: "OPENAI_CODEX_OAUTH_TOKEN",
		legacyPath: [".codex", "auth.json"],
		legacy: { tokens: { access_token: "legacy-token", account_id: "legacy-account" } },
	},
];

const rejectedValues: Array<[string, unknown]> = [
	["empty", ""],
	["whitespace", " \t "],
	["command", "!op read secret"],
	["padded command", " \t!op read secret "],
	["embedded CR", "token\rsuffix"],
	["embedded LF", "token\nsuffix"],
	["embedded CRLF", "token\r\nsuffix"],
	["number", 42],
	["boolean", true],
	["object", { token: "secret" }],
	["array", ["secret"]],
];

for (const target of targets) {
	for (const [label, contents] of [
		["absent file", undefined],
		["malformed JSON", "{"],
		["null document", "null"],
		["absent entry", "{}"],
		["null entry", JSON.stringify({ [target.key]: null })],
		["bare-string entry", JSON.stringify({ [target.key]: "not-a-token-entry" })],
	]) {
		test(`${target.name}: ${label} reports NO_CREDENTIALS or uses legacy fallback`, async () => {
			const provider = target.provider();
			const requests: Headers[] = [];
			const { deps, files } = createDeps({
				fetch: async (_url, init) => {
					requests.push(new Headers(init?.headers));
					return createJsonResponse({});
				},
			});
			if (contents !== undefined) files.set(getAuthPath(deps.homedir()), contents);
			assert.equal(provider.hasCredentials(deps), false);
			assert.equal((await provider.fetchUsage(deps)).error?.code, "NO_CREDENTIALS");
			assert.equal(requests.length, 0);

			files.set(path.join(deps.homedir(), ...target.legacyPath), JSON.stringify(target.legacy));
			assert.equal(provider.hasCredentials(deps), true);
			assert.equal((await provider.fetchUsage(deps)).error, undefined);
			assert.equal(requests.length, 1);
			assert.equal(requests[0].get("authorization"), `${target.scheme} legacy-token`);
		});
	}

	for (const [label, value] of rejectedValues) {
		test(`${target.name}: rejects ${label} pi token and continues to legacy credentials`, async () => {
			const provider = target.provider();
			const requests: Record<string, string>[] = [];
			const { deps, files } = createDeps({
				fetch: async (_url, init) => {
					requests.push(init?.headers as Record<string, string>);
					return createJsonResponse({});
				},
			});
			files.set(getAuthPath(deps.homedir()), JSON.stringify({
				[target.key]: { [target.field]: value, accountId: "rejected-pi-account" },
			}));

			assert.equal(provider.hasCredentials(deps), false);
			const missing = await provider.fetchUsage(deps);
			assert.equal(missing.error?.code, "NO_CREDENTIALS");
			assert.equal(requests.length, 0, "invalid pi tokens must not reach fetch");

			files.set(path.join(deps.homedir(), ...target.legacyPath), JSON.stringify(target.legacy));
			assert.equal(provider.hasCredentials(deps), true);
			const usage = await provider.fetchUsage(deps);
			assert.equal(usage.error, undefined);
			assert.equal(requests.length, 1);
			assert.equal(requests[0].Authorization, `${target.scheme} legacy-token`);
			if (target.key === "openai-codex") {
				assert.equal(requests[0]["ChatGPT-Account-Id"], "legacy-account");
			}
		});
	}

	for (const [label, value, type] of [
		["plain", "valid-token", undefined],
		["padded", " \tvalid-token ", "oauth"],
		// normalizeCredentialString trims before rejecting remaining CR/LF.
		["surrounding CRLF", "\r\nvalid-token\r\n", "api_key"],
	]) {
		test(`${target.name}: accepts ${label} pi token ahead of legacy, behind env`, async () => {
			const provider = target.provider();
			const requests: Record<string, string>[] = [];
			const { deps, files } = createDeps({
				fetch: async (_url, init) => {
					requests.push(init?.headers as Record<string, string>);
					assert.equal(new Headers(init?.headers).get("authorization"), requests.at(-1)?.Authorization);
					return createJsonResponse({});
				},
			});
			files.set(getAuthPath(deps.homedir()), JSON.stringify({
				[target.key]: { type, [target.field]: value, accountId: " pi-account " },
			}));
			files.set(path.join(deps.homedir(), ...target.legacyPath), JSON.stringify(target.legacy));

			assert.equal(provider.hasCredentials(deps), true);
			const usage = await provider.fetchUsage(deps);
			assert.equal(usage.error, undefined);
			assert.equal(requests.length, 1);
			assert.equal(requests[0].Authorization, `${target.scheme} valid-token`);
			if (target.key === "openai-codex") {
				assert.equal(requests[0]["ChatGPT-Account-Id"], " pi-account ");
			}

			deps.env[target.env] = "env-token";
			await provider.fetchUsage(deps);
			assert.equal(requests.length, 2);
			assert.equal(requests[1].Authorization, `${target.scheme} env-token`);
		});
	}
}

for (const [label, refresh] of rejectedValues) {
	test(`copilot: rejected ${label} refresh falls through to valid pi access`, async () => {
		const provider = new CopilotProvider();
		const requests: Record<string, string>[] = [];
		const { deps, files } = createDeps({
			fetch: async (_url, init) => {
				requests.push(init?.headers as Record<string, string>);
				return createJsonResponse({});
			},
		});
		files.set(getAuthPath(deps.homedir()), JSON.stringify({
			"github-copilot": { refresh, access: " access-token " },
		}));
		assert.equal(provider.hasCredentials(deps), true);
		assert.equal((await provider.fetchUsage(deps)).error, undefined);
		assert.equal(requests.length, 1);
		assert.equal(requests[0].Authorization, "token access-token");
	});
}

test("copilot: valid pi refresh remains preferred over valid access", async () => {
	const requests: Record<string, string>[] = [];
	const { deps, files } = createDeps({
		fetch: async (_url, init) => {
			requests.push(init?.headers as Record<string, string>);
			return createJsonResponse({});
		},
	});
	files.set(getAuthPath(deps.homedir()), JSON.stringify({
		"github-copilot": { refresh: " refresh-token ", access: "access-token" },
	}));
	const provider = new CopilotProvider();
	assert.equal(provider.hasCredentials(deps), true);
	assert.equal((await provider.fetchUsage(deps)).error, undefined);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].Authorization, "token refresh-token");
});
