export type * from "./domain/model.js";
export type { BuiltinPolicy, DeepReadonly } from "./domain/policy.js";
export { builtinPolicy, freeze, validatePolicy } from "./domain/policy.js";
export { captureRuntimeEnvironment } from "./infrastructure/deployment.js";

import type { PersistentSettings } from "./domain/model.js";
export interface SettingsStore {
	readonly settings: Readonly<PersistentSettings>;
	update(settings: PersistentSettings): Promise<Readonly<PersistentSettings>>;
}
