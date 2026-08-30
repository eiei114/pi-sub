/**
 * Sync the ROADMAP.md release status table with workspace package versions.
 *
 * Runs as part of `npm run version` so the Version Packages PR always carries
 * the updated table — keeping the roadmap-accuracy test green on main after
 * every release, without manual edits.
 */
/* global process, console */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const packagesDir = join(root, "packages");
const roadmapPath = join(root, "ROADMAP.md");

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const versions = new Map();
for (const dir of readdirSync(packagesDir)) {
	try {
		const pkg = JSON.parse(readFileSync(join(packagesDir, dir, "package.json"), "utf8"));
		if (typeof pkg.name === "string" && pkg.name.startsWith("@eiei114/pi-sub-") && pkg.version) {
			versions.set(pkg.name, pkg.version);
		}
	} catch {
		// Skip unreadable package.json files.
	}
}

let roadmap = readFileSync(roadmapPath, "utf8");
let updated = 0;
for (const [name, version] of versions) {
	const pattern = new RegExp(
		"(\\| \\[`" + escapeRegExp(name) + "`\\]\\([^)]*\\) \\| `)([^`]+)(` \\|)"
	);
	if (pattern.test(roadmap)) {
		roadmap = roadmap.replace(pattern, `$1${version}$3`);
		updated += 1;
	}
}

if (updated > 0) {
	writeFileSync(roadmapPath, roadmap);
}
console.log(`synced ${updated} package version(s) in ROADMAP.md`);
