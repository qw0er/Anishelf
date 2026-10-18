import { basename } from "node:path";
import { canonicalPath } from "../../../../platform/canonical-path.js";
import type { PersistentSettings } from "../../../system/public.js";
import { resourceRootId } from "../domain/identity.js";
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
