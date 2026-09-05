/** Current-session Codex usage. Never shares the legacy provider-only disk cache. */
import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Dependencies, UsageSnapshot } from "../types.js";
import { CodexProvider } from "../providers/impl/codex.js";
import { noCredentials, fetchFailed } from "../errors.js";

export function isActiveCodex(ctx: ExtensionContext): boolean {
	return /^openai-codex(?:-\d+)?$/.test(ctx.model?.provider ?? "");
}

async function resolveHeaders(ctx: ExtensionContext): Promise<Headers> {
	const model = ctx.model!;
	// New Pi hosts resolve model and OAuth headers together. Older hosts expose getApiKey.
	type ResolvedAuth = { ok: boolean; apiKey?: string; headers?: Record<string, string | null> };
	const registry = ctx.modelRegistry as unknown as {
		getApiKeyAndHeaders?: (model: typeof ctx.model) => Promise<ResolvedAuth>;
		getApiKey?: (model: typeof ctx.model) => Promise<string | undefined>;
	};
	const auth: ResolvedAuth = registry.getApiKeyAndHeaders
		? await registry.getApiKeyAndHeaders(model)
		: { ok: Boolean(registry.getApiKey), apiKey: await registry.getApiKey?.(model) };
	if (!auth.ok) throw new Error("Selected subscription authentication failed");
	const headers = new Headers(model.headers);
	for (const [key, value] of Object.entries(auth.headers ?? {})) {
		if (value === null) headers.delete(key);
		else headers.set(key, value);
	}
	if (auth.apiKey) headers.set("authorization", `Bearer ${auth.apiKey}`);
	const token = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
	if (!token) throw new Error("Selected subscription has no credentials");
	if (!headers.has("chatgpt-account-id")) {
		try {
			const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
			const account = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
			if (typeof account === "string" && account) headers.set("chatgpt-account-id", account);
		} catch { /* Opaque tokens may supply the account through resolved headers. */ }
	}
	headers.set("accept", "application/json");
	return headers;
}

export function createActiveCodexUsage(deps: Dependencies) {
	let provider: string | undefined;
	let usage: UsageSnapshot | undefined;
	let identity: string | undefined;
	let fetchedAt = 0;
	let generation = 0;
	let pending: Promise<UsageSnapshot> | undefined;
	const fetcher = new CodexProvider();

	function clear(): void {
		generation++;
		provider = undefined;
		usage = undefined;
		identity = undefined;
		fetchedAt = 0;
		pending = undefined;
	}

	async function refresh(
		ctx: ExtensionContext,
		ttlMs: number,
		minIntervalMs: number,
		onUpdate: (usage?: UsageSnapshot) => void,
		options?: { force?: boolean; skipFetch?: boolean },
	): Promise<void> {
		const selected = ctx.model!.provider;
		if (selected !== provider) {
			clear();
			provider = selected;
		}
		const version = generation;
		const current = () => version === generation && ctx.model?.provider === selected;
		onUpdate(usage);
		if (options?.skipFetch) return;
		try {
			const headers = await resolveHeaders(ctx);
			if (!current()) return;
			const nextIdentity = createHash("sha256").update(JSON.stringify([...headers])).digest("hex");
			if (nextIdentity !== identity) {
				identity = nextIdentity;
				usage = undefined;
				fetchedAt = 0;
				pending = undefined;
				onUpdate(undefined);
			}
			const age = Date.now() - fetchedAt;
			if (usage && (age < minIntervalMs || (!options?.force && age < ttlMs))) {
				onUpdate(usage);
				return;
			}
			const request = pending ??= fetcher.fetchUsage(deps, headers);
			const result = await request;
			if (!current() || identity !== nextIdentity) return;
			if (pending === request) pending = undefined;
			usage = { ...result, displayName: `Codex (${selected})` };
			fetchedAt = Date.now();
			onUpdate(usage);
		} catch {
			if (!current()) return;
			// Never fall back to another subscription, even if its cache is healthy.
			usage = { provider: "codex", displayName: `Codex (${selected})`, windows: [],
				error: identity ? fetchFailed() : noCredentials() };
			onUpdate(usage);
		}
	}

	return { refresh, clear, get provider() { return provider; }, get usage() { return usage; } };
}
