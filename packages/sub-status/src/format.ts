import type { ProviderStatus, RateWindow, UsageSnapshot } from "@eiei114/pi-sub-shared";

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function formatWindow(window: RateWindow): string {
	const percent = `${clampPercent(window.usedPercent)}%`;
	const label = window.resetDescription?.trim() || window.label.trim();
	return label ? `${label} ${percent}` : percent;
}

function mapIncident(status?: ProviderStatus): string | undefined {
	if (!status || status.indicator === "none") return undefined;
	switch (status.indicator) {
		case "minor":
			return "degraded";
		case "major":
		case "critical":
			return "outage";
		case "maintenance":
			return "maintenance";
		case "unknown":
		default:
			return "unknown";
	}
}

function isStale(usage: UsageSnapshot): boolean {
	return Boolean(usage.error && usage.lastSuccessAt);
}

function isSyntheticStaleStatus(usage: UsageSnapshot): boolean {
	// sub-core currently uses a minor status with an elapsed description for stale fallback data.
	return isStale(usage) && usage.status?.indicator === "minor";
}

/**
 * Format the current usage snapshot into a compact status-line string.
 */
export function formatCompactStatus(usage: UsageSnapshot | undefined): string | undefined {
	if (!usage || usage.windows.length === 0) {
		return undefined;
	}

	const parts = usage.windows.slice(0, 2).map(formatWindow);
	if (parts.length === 0) {
		return undefined;
	}

	if (isStale(usage)) {
		parts.push("stale");
	}

	if (!isSyntheticStaleStatus(usage)) {
		const incident = mapIncident(usage.status);
		if (incident) {
			parts.push(incident);
		}
	}

	return parts.join(" · ");
}

function textWidth(text: string): number {
	return Array.from(text).length;
}

/**
 * Width-aware compact status with percent top priority.
 *
 * Priority (highest first): percent > window label > stale/incident suffixes.
 * Degraded levels join with a single ASCII space and the narrowest levels use
 * pure ASCII percent text, so the result is identical on macOS and Windows.
 * Returns "" when even the first window percent does not fit, so callers hide
 * the line instead of showing a misleading partial percent.
 */
export function formatCompactStatusWithWidth(usage: UsageSnapshot | undefined, width: number): string | undefined {
	const full = formatCompactStatus(usage);
	if (full === undefined) return undefined;
	if (!(width > 0)) return full;
	if (textWidth(full) <= width) return full;
	if (!usage || usage.windows.length === 0) return full;
	const windows = usage.windows.slice(0, 2);
	const labeled = windows.map(formatWindow).filter(Boolean).join(' ');
	if (labeled && textWidth(labeled) <= width) return labeled;
	const pcts = windows.map((w) => `${clampPercent(w.usedPercent)}%`).join(' ');
	if (pcts && textWidth(pcts) <= width) return pcts;
	const first = windows.length > 0 ? `${clampPercent(windows[0].usedPercent)}%` : '';
	if (first && textWidth(first) <= width) return first;
	return '';
}
