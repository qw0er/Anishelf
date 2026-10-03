import type { Logger } from "pino";
import type {
	PersistentSettings,
	SettingsStore,
} from "../../configuration/public.js";
import type { ScanCoordinator } from "./scan-coordinator.js";
/** Root switching is one coordinated use case, not a configuration side effect. */
export class SettingsApplication {
	constructor(
		private readonly options: {
			configuration: SettingsStore;
			scans: ScanCoordinator;
			rootChanged(): void;
			logger: Logger;
		},
	) {}
	getSettings(): Readonly<PersistentSettings> {
		return { ...this.options.configuration.settings };
	}
	async updateSettings(input: {
		resourceRoot: string;
		scanIntervalMinutes?: number;
	}): Promise<Readonly<PersistentSettings>> {
		const previousRoot = this.getSettings().resourceRoot;
		const next = { ...this.getSettings(), ...input };
		const settings = await this.options.scans.withSettingsChange(async () => {
			const saved = await this.options.configuration.update(next);
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
