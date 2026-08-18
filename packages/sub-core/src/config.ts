/**
 * Configuration constants for the sub-bar extension
 */

/**
 * Google Workspace status API endpoint
 */
export const GOOGLE_STATUS_URL = "https://www.google.com/appsstatus/dashboard/incidents.json";

/**
 * Google product ID for Gemini in the status API
 */
export const GEMINI_PRODUCT_ID = "npdyhgECDJ6tB66MxXyo";

/**
 * Model multipliers for Copilot request counting
 * Maps model display names to their request multiplier
 */
export { MODEL_MULTIPLIERS } from "@eiei114/pi-sub-shared";

/**
 * Timeout for API requests in milliseconds
 */
export const API_TIMEOUT_MS = 5000;

/**
 * OpenRouter credits endpoint
 */
export const OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits";

/**
 * Cursor usage endpoints (unofficial)
 */
export const CURSOR_AUTH_USAGE_URL = "https://api2.cursor.sh/auth/usage";
export const CURSOR_USAGE_SUMMARY_URL = "https://cursor.com/api/usage-summary";
/** Exchange `crsr_…` API keys for a short-lived JWT access token. */
export const CURSOR_EXCHANGE_API_KEY_URL = "https://api2.cursor.sh/auth/exchange_user_api_key";
/** Dashboard period usage (Models / Other rails) via Bearer access token. */
export const CURSOR_CURRENT_PERIOD_USAGE_URL =
	"https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";

/**
 * OpenCode Go usage endpoint (unofficial)
 */
export const OPENCODE_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

/**
 * Command Code billing endpoints (unofficial)
 */
export const COMMAND_CODE_WHOAMI_URL = "https://api.commandcode.ai/alpha/whoami";
export const COMMAND_CODE_CREDITS_URL = "https://api.commandcode.ai/alpha/billing/credits";

/**
 * Timeout for CLI commands in milliseconds
 */
export const CLI_TIMEOUT_MS = 10000;

/**
 * Interval for automatic usage refresh in milliseconds
 */
export const REFRESH_INTERVAL_MS = 60_000;

