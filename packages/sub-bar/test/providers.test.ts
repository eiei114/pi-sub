import test from "node:test";
import assert from "node:assert/strict";
import { getUsageExtras } from "../src/providers/extras.js";
import { shouldShowWindow } from "../src/providers/windows.js";
import { applyProviderSettingsChange, buildProviderSettingsItems } from "../src/providers/settings.js";
import { getDefaultSettings, mergeSettings } from "../src/settings-types.js";
import type { UsageSnapshot } from "../src/types.js";

function buildCopilotUsage(): UsageSnapshot {
	return {
		provider: "copilot",
		displayName: "GitHub Copilot",
		windows: [],
		requestsRemaining: 100,
		requestsEntitlement: 200,
	};
}

function buildOpenRouterUsage(extra?: Partial<UsageSnapshot>): UsageSnapshot {
	return {
		provider: "openrouter",
		displayName: "OpenRouter Credits",
		windows: [],
		creditTotal: 20,
		creditUsage: 7.25,
		creditRemaining: 12.75,
		...extra,
	};
}

test("copilot extras include multiplier and requests left", () => {
	const settings = getDefaultSettings();
	settings.providers.copilot.showMultiplier = true;
	settings.providers.copilot.showRequestsLeft = true;

	const extras = getUsageExtras(buildCopilotUsage(), settings, "GPT-4o");
	assert.equal(extras.length, 1);
	assert.ok(extras[0].label.includes("Model multiplier: 0x"));
	assert.ok(extras[0].label.includes("req. left"));
});

test("copilot extras respect toggle settings", () => {
	const settings = getDefaultSettings();
	settings.providers.copilot.showMultiplier = false;

	const extras = getUsageExtras(buildCopilotUsage(), settings, "GPT-4o");
	assert.equal(extras.length, 0);

	settings.providers.copilot.showMultiplier = true;
	settings.providers.copilot.showRequestsLeft = false;

	const withMultiplierOnly = getUsageExtras(buildCopilotUsage(), settings, "GPT-4o");
	assert.equal(withMultiplierOnly.length, 1);
	assert.ok(withMultiplierOnly[0].label.includes("Model multiplier: 0x"));
	assert.ok(!withMultiplierOnly[0].label.includes("req. left"));
});

test("openrouter extras show remaining account credit by default", () => {
	const settings = getDefaultSettings();

	const extras = getUsageExtras(buildOpenRouterUsage(), settings);
	assert.equal(extras.length, 1);
	assert.equal(extras[0].label, "Account credit: $12.75 left");
});

test("openrouter extras can include breakdown", () => {
	const settings = getDefaultSettings();
	settings.providers.openrouter.showCreditBreakdown = true;

	const extras = getUsageExtras(buildOpenRouterUsage(), settings);
	assert.equal(extras.length, 1);
	assert.equal(extras[0].label, "Account credit: $12.75 left ($7.25/$20.00 used)");
});

test("openrouter extras respect showRemainingCredit toggle", () => {
	const settings = getDefaultSettings();
	settings.providers.openrouter.showRemainingCredit = false;

	const extras = getUsageExtras(buildOpenRouterUsage(), settings);
	assert.equal(extras.length, 0);
});

test("openrouter key spend is labelled apart from account credit", () => {
	const settings = getDefaultSettings();

	const extras = getUsageExtras(
		buildOpenRouterUsage({ keyUsage: 7.5, keyLimit: 10, keyRemaining: 2.5 }),
		settings,
	);

	assert.deepEqual(
		extras.map((extra) => extra.label),
		["Key spend: $7.50", "Key cap: $10.00", "Account credit: $12.75 left"],
	);
});

test("openrouter reports an uncapped key as having no cap", () => {
	const settings = getDefaultSettings();

	const extras = getUsageExtras(
		buildOpenRouterUsage({ keyUsage: 0.125, keyLimit: null }),
		settings,
	);

	assert.deepEqual(
		extras.map((extra) => extra.label),
		["Key spend: $0.1250", "Key cap: none", "Account credit: $12.75 left"],
	);
});

test("openrouter omits the cap line when the cap is unknown", () => {
	const settings = getDefaultSettings();

	const extras = getUsageExtras(buildOpenRouterUsage({ keyUsage: 1 }), settings);

	assert.deepEqual(
		extras.map((extra) => extra.label),
		["Key spend: $1.00", "Account credit: $12.75 left"],
	);
});

test("openrouter reports an unreadable wallet instead of showing nothing", () => {
	const settings = getDefaultSettings();

	const extras = getUsageExtras(
		{
			provider: "openrouter",
			displayName: "OpenRouter",
			windows: [],
			keyUsage: 3,
			keyLimit: null,
			creditUnavailable: true,
		},
		settings,
	);

	assert.deepEqual(
		extras.map((extra) => extra.label),
		["Key spend: $3.00", "Key cap: none", "Account credit: unavailable"],
	);
});

test("openrouter wallet toggles never hide or relabel key data", () => {
	const settings = getDefaultSettings();
	settings.providers.openrouter.showRemainingCredit = false;
	settings.providers.openrouter.showCreditBreakdown = true;

	const extras = getUsageExtras(
		buildOpenRouterUsage({ keyUsage: 7.5, keyLimit: 10, keyRemaining: 2.5 }),
		settings,
	);

	assert.deepEqual(
		extras.map((extra) => extra.label),
		["Key spend: $7.50", "Key cap: $10.00"],
	);
});

test("openrouter showKeySpend toggle hides only key lines", () => {
	const settings = getDefaultSettings();
	settings.providers.openrouter.showKeySpend = false;

	const extras = getUsageExtras(
		buildOpenRouterUsage({ keyUsage: 7.5, keyLimit: 10, keyRemaining: 2.5 }),
		settings,
	);

	assert.deepEqual(
		extras.map((extra) => extra.label),
		["Account credit: $12.75 left"],
	);
});

test("openrouter window toggles separate the key cap from the wallet", () => {
	const settings = getDefaultSettings();
	const usage = buildOpenRouterUsage({
		windows: [
			{ label: "Key limit", usedPercent: 75 },
			{ label: "Credits", usedPercent: 36 },
		],
	});

	assert.equal(shouldShowWindow(usage, usage.windows[0], settings), true);
	assert.equal(shouldShowWindow(usage, usage.windows[1], settings), true);

	settings.providers.openrouter.windows.showKeyLimit = false;
	assert.equal(shouldShowWindow(usage, usage.windows[0], settings), false);
	assert.equal(shouldShowWindow(usage, usage.windows[1], settings), true);

	settings.providers.openrouter.windows.showKeyLimit = true;
	settings.providers.openrouter.windows.showCredits = false;
	assert.equal(shouldShowWindow(usage, usage.windows[0], settings), true);
	assert.equal(shouldShowWindow(usage, usage.windows[1], settings), false);
});

test("openrouter provider settings expose key and account toggles", () => {
	const items = buildProviderSettingsItems(getDefaultSettings(), "openrouter");
	const byId = new Map(items.map((item) => [item.id, item]));

	assert.equal(byId.get("showKeyLimit")?.currentValue, "on");
	assert.equal(byId.get("showKeySpend")?.currentValue, "on");
	assert.equal(byId.get("showCredits")?.currentValue, "on");
	assert.equal(byId.get("showRemainingCredit")?.currentValue, "on");
	assert.equal(byId.get("showCreditBreakdown")?.currentValue, "off");

	const settings = getDefaultSettings();
	applyProviderSettingsChange(settings, "openrouter", "showKeySpend", "off");
	applyProviderSettingsChange(settings, "openrouter", "showKeyLimit", "off");
	assert.equal(settings.providers.openrouter.showKeySpend, false);
	assert.equal(settings.providers.openrouter.windows.showKeyLimit, false);
	// Wallet toggles are untouched by the key toggles.
	assert.equal(settings.providers.openrouter.showRemainingCredit, true);
	assert.equal(settings.providers.openrouter.windows.showCredits, true);
});

test("openrouter settings defaults survive a merge of older stored settings", () => {
	const merged = mergeSettings({
		providers: {
			openrouter: {
				showStatus: false,
				showRemainingCredit: false,
				showCreditBreakdown: true,
				windows: { showCredits: false },
			},
		},
	} as never);

	// Pre-existing choices are preserved, new toggles fall back to defaults.
	assert.equal(merged.providers.openrouter.showRemainingCredit, false);
	assert.equal(merged.providers.openrouter.showCreditBreakdown, true);
	assert.equal(merged.providers.openrouter.windows.showCredits, false);
	assert.equal(merged.providers.openrouter.showKeySpend, true);
	assert.equal(merged.providers.openrouter.windows.showKeyLimit, true);
});

function buildCommandCodeUsage(): UsageSnapshot {
	return {
		provider: "command-code",
		displayName: "Command Code",
		windows: [
			{ label: "5h", usedPercent: 10 },
			{ label: "Week", usedPercent: 20 },
		],
		creditRemaining: 42,
		requestsSummary: "purchased 10 · free 2",
	};
}

test("command-code extras show monthly and credit parts", () => {
	const settings = getDefaultSettings();
	const extras = getUsageExtras(buildCommandCodeUsage(), settings);
	assert.equal(extras.length, 2);
	assert.equal(extras[0].label, "monthly 42");
	assert.equal(extras[1].label, "purchased 10 · free 2");
});

test("command-code extras respect showCredits toggle", () => {
	const settings = getDefaultSettings();
	settings.providers["command-code"].showCredits = false;
	const extras = getUsageExtras(buildCommandCodeUsage(), settings);
	assert.equal(extras.length, 0);
});
