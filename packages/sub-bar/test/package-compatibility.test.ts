import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { containsAllTokens, normalizeTokens } from "@eiei114/pi-sub-shared";

// The token-matching API first shipped in shared 2.7.2, not 2.7.1.
// Workspace symlinks otherwise mask incompatible minimum runtime dependencies.
const firstTokenMatchingRelease = [2, 7, 2];

for (const consumer of ["sub-bar", "sub-core"]) {
	test(`${consumer} requires a shared release that exports containsAllTokens`, () => {
		const manifest = JSON.parse(
			readFileSync(new URL(`../../${consumer}/package.json`, import.meta.url), "utf8"),
		) as { dependencies: Record<string, string> };
		const range = manifest.dependencies["@eiei114/pi-sub-shared"];
		const match = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
		assert.ok(match, `Expected a caret version for pi-sub-shared, got ${range}`);
		const minimum = match.slice(1).map(Number);
		const differingIndex = minimum.findIndex((part, index) => part !== firstTokenMatchingRelease[index]);
		assert.ok(
			differingIndex === -1 || minimum[differingIndex] > firstTokenMatchingRelease[differingIndex],
			`${consumer} allows shared versions without containsAllTokens: ${range}`,
		);
	});
}

test("the public shared entry point exports token matching used by the widget", () => {
	assert.equal(containsAllTokens(["codex", "spark"], normalizeTokens("Codex Spark 5h")), true);
	assert.equal(containsAllTokens(["codex", "spark"], normalizeTokens("5h")), false);
	assert.equal(containsAllTokens([], normalizeTokens("gpt-5.6-luna")), false);
});
