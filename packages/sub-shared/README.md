# @eiei114/pi-sub-shared

Shared types, metadata, and event contracts for the `sub-*` ecosystem.

This package is consumed by `sub-core` and `sub-bar` to keep provider metadata, usage types, and model multipliers consistent. For repo setup and extension installation, see the root [pi-sub README](../../README.md).

## Overview

### Installation

```bash
npm install @eiei114/pi-sub-shared
```

### Usage

```ts
import {
  PROVIDERS,
  ProviderName,
  UsageSnapshot,
  getDefaultCoreSettings,
} from "@eiei114/pi-sub-shared";

const defaults = getDefaultCoreSettings();
const provider: ProviderName = "anthropic";
const snapshot: UsageSnapshot = {
  provider,
  displayName: "Anthropic (Claude)",
  windows: [],
};

console.log(PROVIDERS, defaults, snapshot);
```

### Exports

- `PROVIDERS`, `ProviderName`
- `RateWindow`, `UsageSnapshot`, `ProviderUsageEntry`
- `UsageError`, `UsageErrorCode`
- `ProviderStatus`, `StatusIndicator`
- `CoreSettings`, `CoreProviderSettings`, `CoreProviderSettingsMap`
- `BehaviorSettings`, `DEFAULT_BEHAVIOR_SETTINGS`
- `getDefaultCoreSettings`, `getDefaultCoreProviderSettings`
- `SubCoreState`, `SubCoreAllState`, `SubCoreEvents`
- `ProviderMetadata`, `ProviderDetectionConfig`, `ProviderStatusConfig`
- `PROVIDER_METADATA`, `PROVIDER_DISPLAY_NAMES`
- `MODEL_MULTIPLIERS`

### Credential vs. account amounts on `UsageSnapshot`

`creditTotal` / `creditUsage` / `creditRemaining` are **account-level** (wallet)
amounts. `creditUnavailable` marks a refresh where the wallet could not be read,
so callers can say "unknown" instead of showing an older value as current.

`keyLimit` / `keyRemaining` / `keyUsage` describe the **credential in use** and
must never be written into the credit fields. `keyLimit` is `null` when the
credential has no cap (which says nothing about the wallet) and omitted when the
cap could not be determined; neither case has a percentage.

## Development

```bash
npm run check
```

## Related docs

- Root README: [../../README.md](../../README.md)
