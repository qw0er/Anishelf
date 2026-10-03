import type { ResourceAccessApplication } from "./application/access.js";
import { ResourceAccess } from "./infrastructure/access.js";

export type {
	FileInfo,
	FileSourceIdentity,
	RegisteredSource,
	ResolvedSource,
	RootIssue,
	SourceCatalog,
	SourceIdentity,
	SourceReference,
} from "./domain/model.js";
export type {
	OpenedResourceFile,
	ResourceAccess,
} from "./infrastructure/access.js";
export {
	checkResourceRoot,
	getVideoMimeType,
} from "./infrastructure/access.js";
export function createResourceAccess(
	...args: Parameters<typeof ResourceAccess.create>
) {
	return ResourceAccess.create(...args);
}
/** Read-only source capability; consumers cannot change the resource root or scan. */
export type ResourceAccessApi = Pick<
	ResourceAccessApplication,
	| "resolveSource"
	| "revalidateSource"
	| "assertRootEpoch"
	| "resolveRoot"
	| "resourceRootEpoch"
	| "hasSnapshot"
	| "getFile"
	| "openMedia"
	| "openResources"
>;

import type { SourceRepository } from "./infrastructure/repository.js";
export type SourceRegistry = Pick<SourceRepository, "registerSource">;
export { resourceRootId } from "./domain/identity.js";

export { assertSourceVersion } from "./domain/validation.js";
