import type { Logger } from "pino";
import type { ResourceSettingsCoordinator } from "../../public.js";
import type { PersistentSettings, SettingsStore } from "../settings.js";
export type SettingsUpdate = Partial<PersistentSettings> & {
	resourceRoots: string[];
};
/** System owns every setting write; Resources coordinates only resource-related changes. */
export class SettingsApplication {
	constructor(
		private readonly configuration: SettingsStore & {
			patchSettings?(
				patch: Partial<PersistentSettings>,
			): Promise<Readonly<PersistentSettings>>;
		},
		private readonly resources: ResourceSettingsCoordinator,
		private readonly logger: Logger,
	) {}
	getSettings(): Readonly<PersistentSettings> {
		return { ...this.configuration.settings };
	}
	async updateSettings(
		input: SettingsUpdate,
	): Promise<Readonly<PersistentSettings>> {
		const patch: Partial<PersistentSettings> = structuredClone(input);

		const started = Date.now();
		this.logger.debug(
			{ event: "settings.update_started" },
			"Settings update started.",
		);
		const save = async (patch: Partial<PersistentSettings>) => {
			try {
				return await (this.configuration.patchSettings
					? this.configuration.patchSettings(patch)
					: this.configuration.update({
							...this.configuration.settings,
							...patch,
						}));
			} catch (err) {
				this.logger.error(
					{
						event: "settings.persistence_failed",
						err,
						durationMs: Date.now() - started,
					},
					"Settings persistence failed.",
				);
				throw err;
			}
		};
		const saved = await this.resources.applySettingsChange(patch, save);
		this.logger.info(
			{
				event: "settings.updated",
				scanIntervalMinutes: saved.scanIntervalMinutes,
				durationMs: Date.now() - started,
			},
			"Settings saved.",
		);
		return { ...saved };
	}
}
