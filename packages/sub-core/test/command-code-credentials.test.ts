import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { CommandCodeProvider } from "../src/providers/impl/command-code.js";
import { createDeps, createJsonResponse } from "./helpers.js";

for (const directory of [".pi", ".omp"]) {
	test(`command-code ignores unscoped root credentials in ${directory} shared auth`, async () => {
		let requests = 0;
		const { deps, files } = createDeps({
			fetch: async () => {
				requests++;
				return createJsonResponse({});
			},
		});
		files.set(path.join(deps.homedir(), directory, "agent", "auth.json"), JSON.stringify({
			apiKey: "unrelated-root-key",
			openrouter: { key: "another-provider-key" },
		}));
		const provider = new CommandCodeProvider();
		assert.equal(provider.hasCredentials(deps), false);
		assert.equal((await provider.fetchUsage(deps)).error?.code, "NO_CREDENTIALS");
		assert.equal(requests, 0);
	});

	for (const providerName of ["command-code", "commandcode", "command_code"]) {
		test(`command-code reads only ${providerName} from ${directory} shared auth`, async () => {
			const tokens: string[] = [];
			const { deps, files } = createDeps({
				fetch: async (_url, init) => {
					tokens.push(new Headers(init?.headers).get("Authorization") ?? "");
					return createJsonResponse({ org: null });
				},
			});
			files.set(path.join(deps.homedir(), directory, "agent", "auth.json"), JSON.stringify({
				apiKey: "unrelated-root-key",
				[providerName]: { key: "scoped-command-code-key" },
			}));
			const provider = new CommandCodeProvider();
			assert.equal(provider.hasCredentials(deps), true);
			await provider.fetchUsage(deps);
			assert.deepEqual(tokens, ["Bearer scoped-command-code-key", "Bearer scoped-command-code-key"]);
		});
	}
}

test("command-code preserves native root credentials and environment priority", async () => {
	const tokens: string[] = [];
	const { deps, files } = createDeps({
		fetch: async (_url, init) => {
			tokens.push(new Headers(init?.headers).get("Authorization") ?? "");
			return createJsonResponse({ org: null });
		},
	});
	files.set(path.join(deps.homedir(), ".commandcode", "auth.json"), JSON.stringify({ apiKey: "native-key" }));
	const provider = new CommandCodeProvider();
	await provider.fetchUsage(deps);
	deps.env.COMMAND_CODE_API_KEY = "env-key";
	await provider.fetchUsage(deps);
	assert.deepEqual(tokens, ["Bearer native-key", "Bearer native-key", "Bearer env-key", "Bearer env-key"]);
});
