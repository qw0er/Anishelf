export type {
	DeploymentConfig,
	PersistentSettings,
	PreparationMode,
	SettingsStore,
	TranscodeProfile,
} from "./configuration/public.js";
export { transcodeProfileFingerprint } from "./configuration/public.js";

import type { RuntimeEnvironment } from "../../platform/environment.js";
import type { DeepReadonly } from "../../shared/policy.js";
import type {
	DeploymentConfig,
	PersistentSettings,
	PreparationMode,
	SettingsStore,
	TranscodeProfile,
} from "./configuration/public.js";
export interface SystemApi extends SettingsStore {
	readonly deployment: DeepReadonly<DeploymentConfig>;
	readonly environment: RuntimeEnvironment;
	readonly transcodeProfiles: DeepReadonly<TranscodeProfile[]>;
	readonly snapshot: {
		readonly settings: DeepReadonly<
			PersistentSettings & {
				scanIntervalMinutes: number;
				defaultTranscodeProfileId: string;
				preparationMode: PreparationMode;
			}
		>;
	};
	patchSettings(
		input: Partial<PersistentSettings>,
	): Promise<Readonly<PersistentSettings>>;
	selectTranscodeProfile(
		id: string | null,
		mode?: PreparationMode,
	): Promise<Readonly<PersistentSettings>>;
}

/** Resources reserves its scan/root gate around System-owned persistence. */
export interface ResourceSettingsCoordinator {
	applySettingsChange(
		input: Partial<PersistentSettings>,
		save: (
			patch: Partial<PersistentSettings>,
		) => Promise<Readonly<PersistentSettings>>,
	): Promise<Readonly<PersistentSettings>>;
}

export type { AuthenticationStore } from "./authentication/ports.js";
