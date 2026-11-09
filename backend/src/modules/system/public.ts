export type {
	DeploymentConfig,
	PersistentSettings,
	SettingsStore,
	TranscodeProfile,
} from "./configuration/public.js";
export { transcodeProfileFingerprint } from "./configuration/public.js";

import type { RuntimeEnvironment } from "../../platform/environment.js";
import type { DeepReadonly } from "../../shared/policy.js";
import type { ProfileCatalogIssue } from "../../shared/profile-issue.js";
import type {
	DeploymentConfig,
	PersistentSettings,
	SettingsStore,
	TranscodeProfile,
} from "./configuration/public.js";
export interface SystemApi extends SettingsStore {
	readonly transcodeRevision?: string;
	readonly transcodeValidation?: Readonly<
		Record<
			string,
			import("../../platform/media/encoding.js").EncodingValidation
		>
	>;
	configureTranscodeValidation?(
		validator: import("./configuration/profile.js").TranscodeProfileValidator,
		logger?: import("pino").Logger,
	): Promise<void>;
	refreshTranscodeValidation?(): Promise<void>;
	reloadTranscodeProfiles?(): Promise<{
		applied: boolean;
		issues: ProfileCatalogIssue[];
	}>;

	readonly autoPreparationPresets?: DeepReadonly<
		import("../../contracts/auto-preparation.js").AutoPreparationPreset[]
	>;
	readonly autoPreparationIssue?: ProfileCatalogIssue | undefined;
	onSettingsChanged?(listener: () => void): () => void;
	readonly deployment: DeepReadonly<DeploymentConfig>;
	readonly environment: RuntimeEnvironment;
	readonly transcodeProfiles: DeepReadonly<TranscodeProfile[]>;
	readonly transcodeProfileIssue: ProfileCatalogIssue | undefined;
	readonly snapshot: {
		readonly settings: DeepReadonly<
			PersistentSettings & {
				defaultTranscodeProfileId: string;
			}
		>;
	};
	patchSettings(
		input: Partial<PersistentSettings>,
	): Promise<Readonly<PersistentSettings>>;
	selectTranscodeProfile(
		id: string | null,
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
