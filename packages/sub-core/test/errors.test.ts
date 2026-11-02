import test from "node:test";
import assert from "node:assert/strict";
import {
	apiError,
	createError,
	fetchFailed,
	httpError,
	noCli,
	noCredentials,
	notLoggedIn,
	timeout,
} from "../src/errors.js";

test("usage error factories preserve codes, messages, and HTTP status", () => {
	assert.deepEqual(createError("UNKNOWN", "Unknown"), { code: "UNKNOWN", message: "Unknown", httpStatus: undefined });
	assert.deepEqual(noCredentials(), { code: "NO_CREDENTIALS", message: "No credentials found", httpStatus: undefined });
	assert.deepEqual(noCli("vela"), { code: "NO_CLI", message: "vela CLI not found", httpStatus: undefined });
	assert.deepEqual(notLoggedIn(), { code: "NOT_LOGGED_IN", message: "Not logged in", httpStatus: undefined });
	assert.deepEqual(fetchFailed(), { code: "FETCH_FAILED", message: "Fetch failed", httpStatus: undefined });
	assert.deepEqual(fetchFailed("offline"), { code: "FETCH_FAILED", message: "offline", httpStatus: undefined });
	assert.deepEqual(httpError(401), { code: "HTTP_ERROR", message: "HTTP 401", httpStatus: 401 });
	assert.deepEqual(apiError("Bad response"), { code: "API_ERROR", message: "Bad response", httpStatus: undefined });
	assert.deepEqual(timeout(), { code: "TIMEOUT", message: "Request timed out", httpStatus: undefined });
});
