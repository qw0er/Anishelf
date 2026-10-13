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
			rootChanged(): void;
			logger: Logger;
		},
	) {}
	getSettings(): Readonly<PersistentSettings> {
		return { ...this.options.configuration.settings };
	}
	updateResourceSettings(input: {
		resourceRoot: string;
		scanIntervalMinutes?: number;
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
	async coordinateSettingsChange(
		save: () => Promise<Readonly<PersistentSettings>>,
	): Promise<Readonly<PersistentSettings>> {
		const previousRoot = this.getSettings().resourceRoot;
		const settings = await this.options.scans.withSettingsChange(async () => {
			const saved = await save();
			if (saved.resourceRoot !== previousRoot) {
				this.options.rootChanged();
				this.options.scans.reset();
			}
			return { ...saved };
		});
		if (
			!this.options.scans.isClosed &&
			settings.resourceRoot !== previousRoot
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
