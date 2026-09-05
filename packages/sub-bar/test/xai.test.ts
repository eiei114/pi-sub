import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { formatUsageStatus, formatUsageStatusWithWidth } from "../src/formatting.js";
import { shouldShowWindow } from "../src/providers/windows.js";
import { buildProviderSettingsItems, applyProviderSettingsChange } from "../src/providers/settings.js";
import { getDefaultSettings } from "../src/settings-types.js";
import type { UsageSnapshot } from "../src/types.js";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

function buildXaiUsage(label: string): UsageSnapshot {
	return {
		provider: "xai",
		displayName: "xAI (Grok) Plan",
		windows: [
			{
				label,
				usedPercent: 37,
				resetDescription: "3d",
				resetAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
			},
		],
	};
}

test("xai windows are visible by default", () => {
	const settings = getDefaultSettings();
	for (const label of ["Week", "Month", "Usage"]) {
		const usage = buildXaiUsage(label);
		assert.ok(shouldShowWindow(usage, usage.windows[0], settings), `${label} should show`);
	}
});

test("xai window toggles hide only their own window", () => {
	const settings = getDefaultSettings();
	settings.providers.xai.windows.showWeek = false;
	assert.equal(shouldShowWindow(buildXaiUsage("Week"), buildXaiUsage("Week").windows[0], settings), false);
	assert.ok(shouldShowWindow(buildXaiUsage("Month"), buildXaiUsage("Month").windows[0], settings));
	assert.ok(shouldShowWindow(buildXaiUsage("Usage"), buildXaiUsage("Usage").windows[0], settings));

	settings.providers.xai.windows.showMonth = false;
	assert.equal(shouldShowWindow(buildXaiUsage("Month"), buildXaiUsage("Month").windows[0], settings), false);

	settings.providers.xai.windows.showUsage = false;
	assert.equal(shouldShowWindow(buildXaiUsage("Usage"), buildXaiUsage("Usage").windows[0], settings), false);
});

test("xai settings items round-trip through applyProviderSettingsChange", () => {
	const settings = getDefaultSettings();
	const ids = buildProviderSettingsItems(settings, "xai").map((item) => item.id);
	assert.deepEqual(ids, ["showStatus", "showWeek", "showMonth", "showUsage"]);

	for (const id of ["showWeek", "showMonth", "showUsage"] as const) {
		applyProviderSettingsChange(settings, "xai", id, "off");
		assert.equal(settings.providers.xai.windows[id], false);
	}

	applyProviderSettingsChange(settings, "xai", "showWeek", "on");
	assert.equal(settings.providers.xai.windows.showWeek, true);
});

test("xai usage renders and stays inside a narrow width", () => {
	const settings = getDefaultSettings();
	const usage = buildXaiUsage("Week");

	const output = formatUsageStatus(theme, usage, undefined, settings);
	assert.ok(output);
	assert.ok(output.includes("Week"));

	for (const width of [20, 40, 80]) {
		const narrow = formatUsageStatusWithWidth(theme, usage, width, undefined, settings);
		assert.ok(narrow);
		assert.ok(visibleWidth(narrow) <= width, `width ${width} overflowed`);
	}
});
