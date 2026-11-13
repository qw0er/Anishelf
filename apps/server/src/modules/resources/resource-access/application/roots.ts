import { DomainError } from "../../../../shared/errors.js";
import type { DeepReadonly } from "../../../../shared/policy.js";
import type { PersistentSettings } from "../../../system/public.js";
import { checkResourceRoot, ResourceAccess } from "../infrastructure/access.js";
import { configuredRoots } from "../infrastructure/roots.js";
import type { ResourceAccessRuntimePolicy } from "../policy.js";
import type {
	ResourceRoot,
	ResourceRootSelection,
	ResourceRootsApi,
} from "../ports.js";

/** Owns directory resolution and availability; every open revalidates the selected scope. */
export class ResourceRoots implements ResourceRootsApi {
	constructor(
		private readonly policy: DeepReadonly<ResourceAccessRuntimePolicy>,
	) {}
	list(settings: Readonly<PersistentSettings>): Promise<ResourceRoot[]> {
		return configuredRoots(settings);
	}
	async inspect(
		settings: Readonly<PersistentSettings>,
	): Promise<ResourceRootSelection> {
		const roots = await Promise.all(
			(await this.list(settings)).map(async (root) => ({
				...root,
				error: await checkResourceRoot({ resourceRoots: [root.path] }),
			})),
		);
		const issue = !roots.length
			? {
					code: "RESOURCE_ROOT_NOT_CONFIGURED" as const,
					message: "Set resource directories before accessing the library.",
				}
			: roots.some((root) => root.error === null)
				? null
				: {
						code: "RESOURCE_ROOT_UNAVAILABLE" as const,
						message: "All resource directories are missing or unreadable.",
					};
		return { roots, issue };
	}
	async resolve(
		settings: Readonly<PersistentSettings>,
		scopeId?: string,
	): Promise<ResourceRoot> {
		const roots = await this.list(settings);
		const root =
			scopeId === undefined && roots.length === 1
				? roots[0]
				: roots.find((root) => root.scopeId === scopeId);
		if (!root)
			throw new DomainError(
				roots.length ? "PLAYBACK_CONFLICT" : "RESOURCE_ROOT_NOT_CONFIGURED",
				"The resource directory is not configured.",
			);
		return root;
	}
	async open(root: ResourceRoot): Promise<ResourceAccess> {
		const resources = await ResourceAccess.create(
			{ resourceRoots: [root.path] },
			this.policy,
		);
		if (resources.scopeId !== root.scopeId)
			throw new DomainError(
				"PLAYBACK_CONFLICT",
				"The resource directory changed while opening it.",
			);
		return resources;
	}
}
