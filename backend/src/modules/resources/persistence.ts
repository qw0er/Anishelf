import type { Store } from "../../platform/database/store.js";
import { createResourceId } from "./library/domain/model.js";
import type { SourceRegistry } from "./public.js";
import { SourceRepository } from "./resource-access/infrastructure/repository.js";

export { mediaSources, resourceRoots } from "./resource-access/persistence.js";
export interface ResourcesPersistence {
	sources: SourceRegistry;
}
export function createResourcesPersistence(store: Store): ResourcesPersistence {
	return { sources: new SourceRepository(store) };
}

/** SQLite migration mechanisms; app registers these before running Drizzle migrations. */
export const resourceIdentityMigrationFunctions = {
	legacy_resource_file_id: (path: string) => createResourceId("file", path),
	scoped_resource_file_id: (scopeId: string, path: string) =>
		createResourceId("file", path, scopeId),
};
