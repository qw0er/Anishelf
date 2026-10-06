export {
	checkResourceRoot,
	getVideoMimeType,
} from "./infrastructure/access.js";

import type { DeepReadonly } from "../../shared/policy.js";
import type { PersistentSettings } from "../../shared/settings.js";
import { ResourceAccess } from "./infrastructure/access.js";
import type { ResourceAccessRuntimePolicy } from "./policy.js";
import type { ResourceFiles } from "./ports.js";
export function createResourceAccess(
	settings: Readonly<PersistentSettings>,
	policy?: DeepReadonly<ResourceAccessRuntimePolicy>,
): Promise<ResourceFiles> {
	return ResourceAccess.create(settings, policy);
}
