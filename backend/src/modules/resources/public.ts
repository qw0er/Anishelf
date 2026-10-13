export type { LibraryApi } from "./library/public.js";
export type {
	FileInfo,
	FileSourceIdentity,
	OpenedResourceFile,
	RegisteredSource,
	ResolvedSource,
	ResourceAccessApi,
	ResourceFiles,
	SourceIdentity,
	SourceRegistry,
} from "./resource-access/public.js";
export {
	assertSourceVersion,
	resourceRootId,
} from "./resource-access/public.js";

import type { ResourceSettingsCoordinator } from "../system/public.js";
import type { LibraryApi } from "./library/public.js";
import type { ResourceAccessApi } from "./resource-access/public.js";
export interface ResourcesApi extends LibraryApi, ResourceSettingsCoordinator {
	readonly sources: ResourceAccessApi;
}
