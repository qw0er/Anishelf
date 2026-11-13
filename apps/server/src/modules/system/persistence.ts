import type { Store } from "../../platform/database/store.js";
import { AuthenticationRepository } from "./authentication/infrastructure/repository.js";
import type { AuthenticationStore } from "./authentication/ports.js";

export {
	authSessions,
	mediaAccessLinks,
} from "./authentication/infrastructure/schema.js";
export function createAuthenticationPersistence(
	store: Store,
): AuthenticationStore {
	return new AuthenticationRepository(store);
}

export * from "./authentication/infrastructure/schema.js";
