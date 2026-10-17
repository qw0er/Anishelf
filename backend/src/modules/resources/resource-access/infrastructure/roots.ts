import { basename } from "node:path";
import { canonicalPath } from "../../../../platform/canonical-path.js";
import type { PersistentSettings } from "../../../system/public.js";
import { resourceRootId } from "../domain/identity.js";
import type { RootIssue } from "../domain/model.js";
import { checkResourceRoot } from "./access.js";
export async function configuredRoots(settings: Readonly<PersistentSettings>) {
	const roots = await Promise.all(
		settings.resourceRoots.map(async (path) => {
			const canonical = await canonicalPath(path);
			return {
				path,
				scopeId: resourceRootId(canonical),
				name: basename(path) || "root",
			};
		}),
	);
	return roots.map((root) => ({
		...root,
		name:
			roots.filter((candidate) => candidate.name === root.name).length > 1
				? `${root.name} (${root.scopeId.slice(0, 6)})`
				: root.name,
	}));
}
export async function rootStatus(settings: Readonly<PersistentSettings>) {
	const roots = await configuredRoots(settings);
	return Promise.all(
		roots.map(async (root) => ({
			...root,
			error: await checkResourceRoot({
				...settings,
				resourceRoots: [root.path],
			}),
		})),
	);
}
export async function checkRoots(
	settings: Readonly<PersistentSettings>,
): Promise<RootIssue | null> {
	if (!settings.resourceRoots.length)
		return {
			code: "RESOURCE_ROOT_NOT_CONFIGURED",
			message: "Set resource directories before accessing the library.",
		};
	const roots = await rootStatus(settings);
	return roots.some((root) => !root.error)
		? null
		: {
				code: "RESOURCE_ROOT_UNAVAILABLE",
				message: "All resource directories are missing or unreadable.",
			};
}
