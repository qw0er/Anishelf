import { ResourceAccessApplication } from "./application/access.js";
import { ResourceRoots } from "./application/roots.js";
import type { ResourceAccessApi } from "./public.js";

export function createResourceAccess(
	options: Omit<
		ConstructorParameters<typeof ResourceAccessApplication>[0],
		"roots"
	> & {
		policy: ConstructorParameters<typeof ResourceRoots>[0];
	},
) {
	const roots = new ResourceRoots(options.policy);
	const sources = new ResourceAccessApplication({
		configuration: options.configuration,
		roots,
		catalog: options.catalog,
	});
	const api: ResourceAccessApi = {
		get accessRevision() {
			return sources.accessRevision;
		},
		get hasSnapshot() {
			return sources.hasSnapshot;
		},
		resolveSource: sources.resolveSource.bind(sources),
		revalidateSource: sources.revalidateSource.bind(sources),
		assertAccessRevision: sources.assertAccessRevision.bind(sources),
		getScope: sources.getScope.bind(sources),
		filePath: sources.filePath.bind(sources),
		getFile: sources.getFile.bind(sources),
		openMedia: sources.openMedia.bind(sources),
		openResources: sources.openResources.bind(sources),
	};
	return { roots, sources, api };
}
