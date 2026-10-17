/**
 * Meta (Muse) subscription provider.
 *
 * Scope of this provider:
 * - It reports the presence of the SUBSCRIPTION credential: the single base
 *   `meta` OAuth entry pi stores in `~/.pi/agent/auth.json`. A developer API
 *   key (`META_API_KEY`, or an `api_key`-style auth entry) belongs to the
 *   pay-as-you-go Model API bucket and is never treated as the subscription.
 * - Meta publishes no Muse subscription usage endpoint: there is no quota,
 *   window, or balance read for the subscription, so there is nothing
 *   truthful to fetch. This provider deliberately performs no network
 *   request and reports an empty window list — signed in, quota unknown.
 *   Consumers must render that as unknown, never as unlimited or zero used.
 * - Tokens are never refreshed, minted, logged, or returned; only their
 *   presence is read. Pi owns the OAuth lifecycle (including re-minting the
 *   short-lived Model API key) when a model is actually used.
 */

import { normalizeCredentialString, readPiAuthEntry } from '../../credentials.js';
import type { Dependencies, UsageSnapshot } from '../../types.js';
import { BaseProvider } from '../../provider.js';
import { noCredentials } from '../../errors.js';

/** pi stores the Meta subscription credential under this auth.json key. */
const META_AUTH_KEY = 'meta';

const normalizeToken = (value: unknown) =>
	normalizeCredentialString(value, { rejectCommandPrefix: true, rejectNewlines: true });

/**
 * Whether pi holds a Meta subscription OAuth credential.
 *
 * The entry counts only when it is an OAuth entry (`type === "oauth"`) with
 * a non-blank identity token (`refresh`) or minted Model API key (`access`).
 * Reading is presence-only: no token value leaves this function.
 */
export function hasMetaSubscriptionCredential(deps: Dependencies): boolean {
	const entry = readPiAuthEntry(deps, META_AUTH_KEY);
	if (!entry || entry.type !== 'oauth') return false;
	return Boolean(normalizeToken(entry.access) ?? normalizeToken(entry.refresh));
}

export class MetaProvider extends BaseProvider {
	readonly name = 'meta' as const;
	readonly displayName = 'Meta (Muse)';

	hasCredentials(deps: Dependencies): boolean {
		return hasMetaSubscriptionCredential(deps);
	}

	async fetchUsage(deps: Dependencies): Promise<UsageSnapshot> {
		if (!hasMetaSubscriptionCredential(deps)) {
			return this.emptySnapshot(noCredentials());
		}

		// No usage endpoint exists to read; an empty window list is the only
		// truthful snapshot (see the file header).
		return this.snapshot({ windows: [] });
	}

	// Meta has no status page wired up here.
}
