import test from "node:test";
import assert from "node:assert/strict";
import {
	isRecord,
	normalizeCredentialString,
	piAuthFilePath,
	readPiAuthEntry,
	readPiAuthEntryValue,
} from "../src/credentials.js";
import { createDeps, getAuthPath } from "./helpers.js";

test("isRecord accepts plain objects and rejects arrays and null", () => {
	assert.equal(isRecord({ key: "value" }), true);
	assert.equal(isRecord([]), false);
	assert.equal(isRecord(null), false);
	assert.equal(isRecord("text"), false);
});

test("normalizeCredentialString trims and rejects empty values", () => {
	assert.equal(normalizeCredentialString("  api-key  "), "api-key");
	assert.equal(normalizeCredentialString(""), undefined);
	assert.equal(normalizeCredentialString("   "), undefined);
	assert.equal(normalizeCredentialString(42), undefined);
});

test("normalizeCredentialString can reject command indirection values", () => {
	assert.equal(
		normalizeCredentialString("!op read openrouter", { rejectCommandPrefix: true }),
		undefined,
	);
	assert.equal(normalizeCredentialString("!op read openrouter"), "!op read openrouter");
});

test("normalizeCredentialString can reject newline-bearing secrets", () => {
	assert.equal(
		normalizeCredentialString("token\nsuffix", { rejectNewlines: true }),
		undefined,
	);
	assert.equal(normalizeCredentialString("token\nsuffix"), "token\nsuffix");
});

test("normalizeCredentialString combines openrouter and xai rejection rules", () => {
	const options = { rejectCommandPrefix: true, rejectNewlines: true };
	assert.equal(normalizeCredentialString(" oauth-token ", options), "oauth-token");
	assert.equal(normalizeCredentialString("!cmd", options), undefined);
	assert.equal(normalizeCredentialString("bad\nsuffix", options), undefined);
});

test("piAuthFilePath points at pi's agent auth.json under the home dir", () => {
	const { deps } = createDeps();
	assert.equal(piAuthFilePath(deps), getAuthPath(deps.homedir()));
});

test("readPiAuthEntry returns the exact entry object for the requested key only", () => {
	const { deps, files } = createDeps();
	files.set(
		getAuthPath(deps.homedir()),
		JSON.stringify({
			meta: { type: "oauth", access: "minted-key", refresh: "identity-token" },
			xai: { type: "oauth", access: "grok-token" },
		})
	);

	assert.deepEqual(readPiAuthEntry(deps, "meta"), {
		type: "oauth",
		access: "minted-key",
		refresh: "identity-token",
	});
	assert.deepEqual(readPiAuthEntry(deps, "xai"), { type: "oauth", access: "grok-token" });
	assert.equal(readPiAuthEntry(deps, "anthropic"), undefined);
});

test("readPiAuthEntry reads as undefined, never throws, for absent or malformed state", () => {
	const missing = createDeps();
	assert.equal(readPiAuthEntry(missing.deps, "meta"), undefined);

	for (const contents of ["{not-json", "[]", "42", "\"text\"", "null"]) {
		const { deps, files } = createDeps();
		files.set(getAuthPath(deps.homedir()), contents);
		assert.equal(readPiAuthEntry(deps, "meta"), undefined, contents);
	}

	for (const entry of ["token-string", 42, null, ["array"]]) {
		const { deps, files } = createDeps();
		files.set(getAuthPath(deps.homedir()), JSON.stringify({ meta: entry }));
		assert.equal(readPiAuthEntry(deps, "meta"), undefined, JSON.stringify(entry));
	}
});

test("readPiAuthEntryValue returns the raw entry value, including bare strings", () => {
	const { deps, files } = createDeps();
	files.set(
		getAuthPath(deps.homedir()),
		JSON.stringify({
			meta: { type: "oauth", access: "minted-key" },
			"opencode-go": "bare-string-key",
			count: 42,
		})
	);

	assert.deepEqual(readPiAuthEntryValue(deps, "meta"), { type: "oauth", access: "minted-key" });
	assert.equal(readPiAuthEntryValue(deps, "opencode-go"), "bare-string-key");
	assert.equal(readPiAuthEntryValue(deps, "count"), 42);
	assert.equal(readPiAuthEntryValue(deps, "absent"), undefined);
	// The record-only variant still refuses non-object entries.
	assert.equal(readPiAuthEntry(deps, "opencode-go"), undefined);
});

test("readPiAuthEntryValue reads as undefined, never throws, for absent or malformed state", () => {
	const missing = createDeps();
	assert.equal(readPiAuthEntryValue(missing.deps, "meta"), undefined);

	for (const contents of ["{not-json", "[]", "null"]) {
		const { deps, files } = createDeps();
		files.set(getAuthPath(deps.homedir()), contents);
		assert.equal(readPiAuthEntryValue(deps, "meta"), undefined, contents);
	}
});
