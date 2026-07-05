/**
 * Settings types and defaults for sub-core
 */

import type {
	CoreSettings,
	CoreProviderSettingsMap,
	CoreProviderSettings,
	BehaviorSettings,
	ProviderName,
	ProviderEnabledSetting,
} from "@eiei114/pi-sub-shared";
import { PROVIDERS, getDefaultCoreSettings } from "@eiei114/pi-sub-shared";

export type {
	CoreProviderSettings,
	CoreProviderSettingsMap,
	BehaviorSettings,
	CoreSettings,
	ProviderEnabledSetting,
} from "@eiei114/pi-sub-shared";

/**
 * Tool registration settings
 */
export interface ToolSettings {
	usageTool: boolean;
	allUsageTool: boolean;
}

/**
 * All settings
 */
export interface Settings extends CoreSettings {
	/** Version for migration */
	version: number;
	/** Tool registration settings */
	tools: ToolSettings;
}

/**
 * Current settings version
 */
export const SETTINGS_VERSION = 3;

/**
 * Default settings
 */
export function getDefaultSettings(): Settings {
	const coreDefaults = getDefaultCoreSettings();
	return {
		version: SETTINGS_VERSION,
		tools: {
			usageTool: false,
			allUsageTool: false,
		},
		providers: coreDefaults.providers,
		behavior: coreDefaults.behavior,
		statusRefresh: coreDefaults.statusRefresh,
		providerOrder: coreDefaults.providerOrder,
		defaultProvider: coreDefaults.defaultProvider,
	};
}

/**
 * Deep merge two objects
 */
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
	const result = { ...target } as T;
	for (const key of Object.keys(source) as (keyof T)[]) {
		const sourceValue = source[key];
		const targetValue = result[key];
		if (
			sourceValue !== undefined &&
			typeof sourceValue === "object" &&
			sourceValue !== null &&
			!Array.isArray(sourceValue) &&
			typeof targetValue === "object" &&
			targetValue !== null &&
			!Array.isArray(targetValue)
		) {
			result[key] = deepMerge(targetValue as object, sourceValue as object) as T[keyof T];
		} else if (sourceValue !== undefined) {
			result[key] = sourceValue as T[keyof T];
		}
	}
	return result;
}

/**
 * Merge settings with defaults (no legacy migrations).
 */
export function mergeSettings(loaded: Partial<Settings>): Settings {
	return deepMerge(getDefaultSettings(), loaded);
}
