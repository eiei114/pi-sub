import test from "node:test";
import assert from "node:assert/strict";
import {
	fetchFailed,
	formatErrorForDisplay,
	httpError,
	isExpectedMissingData,
	noCli,
	noCredentials,
	notLoggedIn,
} from "../src/errors.js";

test("expected credential states and error display strings remain stable", () => {
	assert.equal(isExpectedMissingData(noCredentials()), true);
	assert.equal(isExpectedMissingData(noCli("vela")), true);
	assert.equal(isExpectedMissingData(notLoggedIn()), true);
	assert.equal(isExpectedMissingData(fetchFailed()), false);
	assert.equal(formatErrorForDisplay(noCredentials()), "No creds");
	assert.equal(formatErrorForDisplay(noCli("vela")), "No CLI");
	assert.equal(formatErrorForDisplay(notLoggedIn()), "Not logged in");
	assert.equal(formatErrorForDisplay(httpError(401)), "token no longer valid – please /login again");
	assert.equal(formatErrorForDisplay(httpError(503)), "503");
	assert.equal(formatErrorForDisplay(fetchFailed()), "Fetch failed");
});
