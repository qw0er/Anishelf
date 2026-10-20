import type { Store } from "../../platform/database/store.js";
import type { SourceRegistry } from "./public.js";
import { SourceRepository } from "./resource-access/infrastructure/repository.js";

export { mediaSources, resourceRoots } from "./resource-access/persistence.js";
export interface ResourcesPersistence {
	sources: SourceRegistry;
}
export function createResourcesPersistence(store: Store): ResourcesPersistence {
	return { sources: new SourceRepository(store) };
}
