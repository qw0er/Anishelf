export type { LibraryApi, LibraryChange } from "./library/public.js";
export type {
	FileInfo,
	FileSourceIdentity,
	OpenedResourceFile,
	RegisteredSource,
	ResolvedSource,
	ResourceAccessApi,
	ResourceFiles,
	ResourceScope,
	SourceIdentity,
	SourceRegistry,
} from "./resource-access/public.js";
export { assertSourceVersion } from "./resource-access/public.js";

import type { ResourceSettingsCoordinator } from "../system/public.js";
import type { LibraryApi } from "./library/public.js";
import type { ResourceAccessApi } from "./resource-access/public.js";
export interface ResourcesApi extends LibraryApi, ResourceSettingsCoordinator {
	readonly sources: ResourceAccessApi;
	readonly acquisition?: AcquisitionResources;
}

export interface AcquisitionResources {
	roots(): Promise<{ scopeId: string; name: string; path?: string }[]>;
	validate(scopeId: string, incompletePath: string): Promise<void>;
	inspect(
		scopeId: string,
		relativePath: string,
	): Promise<{ sizeBytes: number; sourceVersion: string }>;
	refresh(
		scopeId: string,
		relativePath: string,
	): Promise<import("./resource-access/public.js").SourceIdentity>;
}
