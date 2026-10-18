import type { Logger } from "pino";
import type {
	PersistentSettings,
	SettingsStore,
} from "../../../system/public.js";
import type { ScanCoordinator } from "./scan-coordinator.js";
/** Root switching is one coordinated use case, not a configuration side effect. */
export class ResourceSettingsApplication {
	constructor(
		private readonly options: {
			configuration: SettingsStore & {
				patchSettings?(
					patch: Partial<PersistentSettings>,
				): Promise<Readonly<PersistentSettings>>;
			};
			scans: ScanCoordinator;
			rootChanged(): Promise<void>;
			logger: Logger;
		},
	) {}
	getSettings(): Readonly<PersistentSettings> {
		return { ...this.options.configuration.settings };
	}
	updateResourceSettings(input: {
		resourceRoots: string[];
	}): Promise<Readonly<PersistentSettings>> {
		const patch = structuredClone(input);
		return this.coordinateSettingsChange(() =>
			this.options.configuration.patchSettings
				? this.options.configuration.patchSettings(patch)
				: this.options.configuration.update({
						...this.options.configuration.settings,
						...patch,
					}),
		);
	}
	applySettingsChange(
		input: Partial<PersistentSettings>,
		save: (
			patch: Partial<PersistentSettings>,
		) => Promise<Readonly<PersistentSettings>>,
	): Promise<Readonly<PersistentSettings>> {
		const patch = structuredClone(input);
		const current = this.getSettings();
		const mediaUpdate =
			patch.transcodeCacheBudgetGiB !== undefined ||
			patch.defaultTranscodeProfileId !== undefined ||
			patch.preparationMode !== undefined;
		const resourceChange =
			JSON.stringify(patch.resourceRoots) !==
				JSON.stringify(current.resourceRoots) || !mediaUpdate;
		if (!resourceChange) {
			delete patch.resourceRoots;
			return save(patch);
		}
		return this.coordinateSettingsChange(() => save(patch));
	}
	async coordinateSettingsChange(
		save: () => Promise<Readonly<PersistentSettings>>,
	): Promise<Readonly<PersistentSettings>> {
		const previousRoot = this.getSettings().resourceRoots;
		const settings = await this.options.scans.withSettingsChange(async () => {
			const saved = await save();
			if (
				JSON.stringify(saved.resourceRoots) !== JSON.stringify(previousRoot)
			) {
				await this.options.rootChanged();
				this.options.logger.info(
					{ event: "resources.scope_invalidated" },
					"Resource configuration changed; source access and the published index were invalidated.",
				);
				await this.options.scans.reset();
			}
			return { ...saved };
		});
		if (
			!this.options.scans.isClosed &&
			settings.resourceRoots.length > 0 &&
			JSON.stringify(settings.resourceRoots) !== JSON.stringify(previousRoot)
		) {
			try {
				await this.options.scans.startScan();
			} catch (err) {
				this.options.logger.warn(
					{ event: "scan.settings_start_failed", err },
					"Settings saved, but the library scan could not be started.",
				);
			}
		}

		return settings;
	}
}
