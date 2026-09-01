/**
 * File lock helpers for storage-backed locks.
 */

import { getStorage } from "../storage.js";

interface LockRecord {
	acquiredAt: number;
	token?: string;
}

export function tryAcquireFileLock(lockPath: string, staleAfterMs: number): string | null {
	const storage = getStorage();
	const token = createLockToken();
	if (tryCreateLock(storage, lockPath, token)) {
		return token;
	}

	const observed = readLockRecord(storage, lockPath);
	const stale = observed
		? isLockStale(observed.acquiredAt, staleAfterMs)
		: isLockFileStale(storage, lockPath, staleAfterMs);
	if (!stale) {
		// Fresh lock held by another process, or an unparseable lock we
		// cannot age-check yet (likely mid-write). Treat as held.
		return null;
	}
	if (!removeObservedStaleLock(storage, lockPath, observed)) {
		return null;
	}
	if (tryCreateLock(storage, lockPath, token)) {
		return token;
	}

	return null;
}

export function releaseFileLock(lockPath: string, token?: string): void {
	const storage = getStorage();
	try {
		if (!storage.exists(lockPath)) {
			return;
		}
		if (token) {
			const current = readLockRecord(storage, lockPath);
			if (!current?.token || current.token !== token) {
				return;
			}
		}
		storage.removeFile(lockPath);
	} catch {
		// Ignore
	}
}

export async function waitForLockRelease(
	lockPath: string,
	maxWaitMs: number,
	pollMs: number = 100
): Promise<boolean> {
	const storage = getStorage();
	const startTime = Date.now();

	while (Date.now() - startTime < maxWaitMs) {
		await new Promise((resolve) => setTimeout(resolve, pollMs));
		if (!storage.exists(lockPath)) {
			return true;
		}
	}

	return false;
}

function tryCreateLock(storage: ReturnType<typeof getStorage>, lockPath: string, token: string): boolean {
	try {
		return storage.writeFileExclusive(lockPath, serializeLockRecord({ token, acquiredAt: Date.now() }));
	} catch {
		return false;
	}
}

function removeObservedStaleLock(
	storage: ReturnType<typeof getStorage>,
	lockPath: string,
	observed: LockRecord | null
): boolean {
	try {
		if (observed) {
			const current = readLockRecord(storage, lockPath);
			if (!current) {
				return false;
			}
			if (current.acquiredAt !== observed.acquiredAt) {
				return false;
			}
			if (current.token !== observed.token) {
				return false;
			}
		} else {
			// observed was an unparseable (empty/corrupt) lock file: only remove it
			// while it is still unparseable, so a concurrent writer that just
			// created a fresh valid lock is never clobbered.
			if (readLockRecord(storage, lockPath) !== null) {
				return false;
			}
		}
		storage.removeFile(lockPath);
		return !storage.exists(lockPath);
	} catch {
		return false;
	}
}

/**
 * An unparseable lock file (e.g. empty, leftover from a crashed process) is
 * only reclaimable once it is older than the stale window. Without a parseable
 * record we fall back to the file mtime; storages without mtime support keep
 * the previous behavior (treated as held) to avoid deleting a live writer's
 * in-flight lock.
 */
function isLockFileStale(storage: ReturnType<typeof getStorage>, lockPath: string, staleAfterMs: number): boolean {
	if (staleAfterMs <= 0) {
		return true;
	}
	const mtimeMs = storage.mtimeMs?.(lockPath);
	if (mtimeMs === undefined) {
		return false;
	}
	return Date.now() - mtimeMs > staleAfterMs;
}

function readLockRecord(storage: ReturnType<typeof getStorage>, lockPath: string): LockRecord | null {
	try {
		if (!storage.exists(lockPath)) {
			return null;
		}
		const lockContent = storage.readFile(lockPath) ?? "";
		return parseLockRecord(lockContent);
	} catch {
		return null;
	}
}

function parseLockRecord(lockContent: string): LockRecord | null {
	const trimmed = lockContent.trim();
	if (!trimmed) return null;

	const asTimestamp = parseInt(trimmed, 10);
	if (Number.isFinite(asTimestamp) && asTimestamp > 0) {
		return { acquiredAt: asTimestamp };
	}

	try {
		const parsed = JSON.parse(trimmed) as { token?: unknown; acquiredAt?: unknown; createdAt?: unknown };
		const acquiredAt = parsed.acquiredAt ?? parsed.createdAt;
		if (typeof acquiredAt !== "number" || !Number.isFinite(acquiredAt) || acquiredAt <= 0) {
			return null;
		}
		const token = typeof parsed.token === "string" && parsed.token ? parsed.token : undefined;
		return { acquiredAt, token };
	} catch {
		return null;
	}
}

function serializeLockRecord(record: LockRecord): string {
	return JSON.stringify(record);
}

function isLockStale(acquiredAt: number, staleAfterMs: number): boolean {
	if (staleAfterMs <= 0) {
		return true;
	}
	return Date.now() - acquiredAt > staleAfterMs;
}

function createLockToken(): string {
	return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
