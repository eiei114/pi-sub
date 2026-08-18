import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { SettingsList } from "../src/ui/settings-list.js";

test("SettingsList hint stays within narrow terminal width", () => {
	const longHint = "↓ navigate • ←/→ change • Enter/Space edit custom • Esc to cancel";
	assert.ok(visibleWidth(longHint) > 51);

	const list = new SettingsList(
		[
			{
				id: "refreshInterval",
				label: "Refresh Interval",
				description: "How often to refresh usage.",
				currentValue: "60s",
				options: ["30s", "60s", "120s"],
			},
		],
		10,
		{
			cursor: "→ ",
			selected: (t: string) => t,
			label: (t: string) => t,
			value: (t: string) => t,
			description: (t: string) => t,
			separator: "  ",
			hint: (text: string) => (text.includes("Enter/Space") ? longHint : text),
		},
		() => {},
		() => {},
	);

	for (const width of [59, 51, 40, 20]) {
		const lines = list.render(width);
		for (const line of lines) {
			assert.ok(
				visibleWidth(line) <= width,
				`line exceeds width ${width}: ${visibleWidth(line)} > ${width} (${JSON.stringify(line)})`,
			);
		}
	}
});
