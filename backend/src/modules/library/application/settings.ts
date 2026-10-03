import type { Logger } from "pino";
import type {
	PersistentSettings,
	SettingsStore,
} from "../../../shared/settings.js";
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
		const started = Date.now();
		this.options.logger.debug(
			{ event: "settings.update_started" },
			"Settings update started.",
		);
		const previousRoot = this.getSettings().resourceRoot;
		const next = { ...this.getSettings(), ...input };
		const settings = await this.options.scans.withSettingsChange(async () => {
			let saved: Readonly<PersistentSettings>;
			try {
				saved = await this.options.configuration.update(next);
			} catch (err) {
				this.options.logger.error(
					{
						event: "settings.persistence_failed",
						err,
						durationMs: Date.now() - started,
					},
					"Settings persistence failed.",
				);
				throw err;
			}
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
		this.options.logger.info(
			{
				event: "settings.updated",
				rootChanged: settings.resourceRoot !== previousRoot,
				scanIntervalMinutes: settings.scanIntervalMinutes,
				durationMs: Date.now() - started,
			},
			"Settings saved.",
		);
		return settings;
	}
}
