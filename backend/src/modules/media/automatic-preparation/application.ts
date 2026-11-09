import type { Logger } from "pino";
import type {
	AutoPreparationPreset,
	ViewingState,
} from "../../../contracts/auto-preparation.js";
import { fingerprint } from "../../../shared/fingerprint.js";
import type { DeepReadonly } from "../../../shared/policy.js";
import type { ResourcesApi, SourceIdentity } from "../../resources/public.js";
import type { SystemApi } from "../../system/public.js";
import type { MediaInspectionApi } from "../media-inspection/public.js";
import type {
	PreparationAutomationApi,
	PreparationStore,
	PreparationTask,
	PreparationView,
} from "../preparation/public.js";
import {
	acceptsMedia,
	matchesPreset,
	planAutomaticPreparation,
	presetFingerprint,
	selectAutomaticAudio,
} from "./planning.js";

export type ViewingReader = (
	sources: readonly SourceIdentity[],
) => Promise<Record<string, ViewingState>>;
const intervalMs = 6 * 60 * 60 * 1000;
export class AutomaticPreparationApplication {
	private closed = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private running: Promise<void> | undefined;
	private dirty = false;
	private offset = 0;
	private revision = -1;
	private paused = false;
	private nextSweep = 0;
	private retryAt = Number.POSITIVE_INFINITY;
	private unsubscribe: (() => void)[] = [];
	constructor(
		private readonly options: {
			system: SystemApi;
			resources: Pick<
				ResourcesApi,
				"sources" | "onSnapshotChanged" | "getStatus" | "readFilePage"
			>;
			inspection: MediaInspectionApi;
			preparation: PreparationAutomationApi;
			repository: PreparationStore;
			viewing: ViewingReader;
			logger: Logger;
			maximumQueuedTasks?: number;
		},
	) {}
	start(): void {
		this.unsubscribe = [
			this.options.resources.onSnapshotChanged(() => this.wake()),
			...(this.options.system.onSettingsChanged
				? [this.options.system.onSettingsChanged(() => this.wake())]
				: []),
		];
		this.options.preparation.setAutomaticGuard((task) => this.eligible(task));
		this.options.preparation.automaticRetry = (id) => this.retry(id);
		this.wake();
	}
	private selected(): DeepReadonly<AutoPreparationPreset> | undefined {
		const system = this.options.system;
		return system.settings.autoPreparationEnabled
			? system.autoPreparationPresets?.find(
					(p) =>
						p.id ===
							(system.settings.autoPreparationPresetId ?? "builtin:web") &&
						system.transcodeProfiles.some((t) => t.id === p.transcodeProfileId),
				)
			: undefined;
	}
	private taskPreset(
		task: PreparationTask,
	): DeepReadonly<AutoPreparationPreset> | undefined {
		const system = this.options.system;
		if (
			!system.settings.autoPreparationEnabled ||
			task.demand?.presetId !==
				(system.settings.autoPreparationPresetId ?? "builtin:web")
		)
			return undefined;
		const saved = task.spec.settings.automaticPreset;
		if (saved?.id === task.demand.presetId) return saved;
		const active = this.selected();
		return active && task.demand.presetFingerprint === presetFingerprint(active)
			? active
			: undefined;
	}
	private async eligible(task: PreparationTask): Promise<boolean> {
		const preset = this.taskPreset(task);
		if (!preset) return false;
		try {
			const source = await this.options.resources.sources.resolveSource(
				task.spec.source.fileId,
				task.spec.source.sourceVersion,
			);
			const states = preset.match?.viewingStates?.length
				? await this.options.viewing([source.identity])
				: {};
			return (
				this.taskPreset(task) === preset &&
				matchesPreset(
					preset,
					source.identity,
					states[source.identity.fileId] ?? "unwatched",
				)
			);
		} catch {
			return false;
		}
	}
	wake(reset = true): void {
		if (this.closed) return;
		if (reset) this.dirty = true;
		clearTimeout(this.timer);
		if (this.running) return;
		this.running = this.run()
			.catch((error) => {
				this.options.logger.warn(
					{
						event: "automatic_preparation.scan_deferred",
						errorName: error instanceof Error ? error.name : "unknown",
					},
					"Automatic preparation check deferred.",
				);
				this.retryAt = Math.min(this.retryAt, Date.now() + 60000);
			})
			.finally(() => {
				this.running = undefined;
				if (this.closed) return;
				if (this.dirty) {
					this.wake(false);
					return;
				}
				const wait = this.paused
					? 1000
					: Math.max(
							1000,
							Math.min(
								this.nextSweep || Date.now() + intervalMs,
								this.retryAt,
							) - Date.now(),
						);
				this.timer = setTimeout(() => {
					if (!this.paused) this.dirty = true;
					this.wake(false);
				}, wait);
				this.timer.unref();
			});
	}
	private async run(): Promise<void> {
		if (this.dirty) {
			this.offset = 0;
			this.revision = -1;
			this.dirty = false;
			this.retryAt = Number.POSITIVE_INFINITY;
			this.nextSweep = Date.now() + intervalMs;
		}
		const preset = this.selected();
		await this.options.preparation.reconcileAutomatic(
			(task) => !!this.taskPreset(task),
		);
		if (!preset || this.closed) {
			this.paused = false;
			return;
		}
		const status = await this.options.resources.getStatus();
		if (!status.ready) {
			this.retryAt = Date.now() + 60000;
			return;
		}
		if (this.revision !== status.revision) {
			this.revision = status.revision;
			this.offset = 0;
		}
		this.paused = false;
		let evaluated = 0;
		while (!this.closed && !this.dirty && this.selected() === preset) {
			const page = this.options.resources.readFilePage(
				this.revision,
				this.offset,
				50,
			);
			const sources = new Map<string, SourceIdentity>();
			if (preset.match?.viewingStates?.length)
				for (const file of page.files) {
					try {
						sources.set(
							file.id,
							(await this.options.resources.sources.resolveSource(file.id))
								.identity,
						);
					} catch {
						/* Revalidated per file below. */
					}
				}
			const states = preset.match?.viewingStates?.length
				? await this.options.viewing([...sources.values()])
				: {};
			for (const file of page.files) {
				if (this.closed || this.dirty) return;
				if (
					this.options.repository.queuedCount() >=
					Math.max(1, (this.options.maximumQueuedTasks ?? 100) - 1)
				) {
					this.paused = true;
					return;
				}
				try {
					await this.evaluate(file.id, preset, false, states);
				} catch (error) {
					this.options.logger.debug(
						{
							event: "automatic_preparation.file_deferred",
							fileId: file.id,
							errorName: error instanceof Error ? error.name : "unknown",
						},
						"Automatic preparation source check deferred.",
					);
					this.retryAt = Math.min(this.retryAt, Date.now() + 60000);
				}
				this.offset++;
				evaluated++;
			}
			if (page.nextOffset === null) break;
			this.offset = page.nextOffset;
			await new Promise<void>((resolve) => setImmediate(resolve));
		}
		this.options.logger.info(
			{
				event: "automatic_preparation.evaluated",
				presetId: preset.id,
				evaluated,
			},
			"Automatic preparation check completed.",
		);
	}
	private async evaluate(
		fileId: string,
		preset: DeepReadonly<AutoPreparationPreset>,
		force = false,
		batchStates?: Record<string, ViewingState>,
	): Promise<PreparationView | undefined> {
		const { resources, system, repository, preparation, inspection } =
			this.options;
		await system.refreshTranscodeValidation?.();
		const revision = system.transcodeRevision;
		const profile = system.transcodeProfiles.find(
			(p) => p.id === preset.transcodeProfileId,
		);
		if (
			!profile ||
			system.transcodeValidation?.[profile.id]?.status === "unsupported"
		)
			return;
		const source = await resources.sources.resolveSource(fileId);
		const states =
			batchStates ??
			(preset.match?.viewingStates?.length
				? await this.options.viewing([source.identity])
				: {});
		if (!matchesPreset(preset, source.identity, states[fileId] ?? "unwatched"))
			return;
		const id = fingerprint({
			source: source.identity,
			preset: presetFingerprint(preset),
			profile,
		});
		let demand = repository.getAutomaticDemand?.(id) ?? {
			id,
			failures: 0,
			nextAttemptAtMs: 0,
		};
		if (!force && demand.nextAttemptAtMs > Date.now()) {
			this.retryAt = Math.min(this.retryAt, demand.nextAttemptAtMs);
			return;
		}
		const inspected = await inspection.inspect(
			fileId,
			source.identity.sourceVersion,
		);
		const selected = selectAutomaticAudio(inspected.info, preset);
		if (selected === null) return;
		const inventory = await preparation.catalog(fileId);
		if (
			inventory.assets.some(
				(asset) =>
					asset.source.sourceVersion === source.identity.sourceVersion &&
					asset.sourceAudioStreamIndices.length === selected.length &&
					selected.every((s) =>
						asset.sourceAudioStreamIndices.includes(s.index),
					) &&
					acceptsMedia(asset.info, preset),
			)
		)
			return;
		const planned = planAutomaticPreparation(
			source.identity,
			inspected.info,
			preset,
			profile,
		);
		if (planned.kind === "playable") return;
		if (planned.kind === "blocked") {
			this.options.logger.debug(
				{
					event: "automatic_preparation.blocked",
					fileId,
					presetId: preset.id,
					reason: planned.reason,
				},
				"Automatic preparation is blocked.",
			);
			demand = { ...demand, nextAttemptAtMs: Date.now() + intervalMs };
			repository.saveAutomaticDemand?.(demand);
			this.retryAt = Math.min(this.retryAt, demand.nextAttemptAtMs);
			return;
		}
		this.options.logger.debug(
			{
				event: "automatic_preparation.plan_resolved",
				fileId,
				presetId: preset.id,
				profileId: profile.id,
				revision,
				executionPlanId: planned.identity.executionPlanId,
				mode: planned.mode,
				reasons: planned.reasons,
			},
			"Automatic preparation plan resolved.",
		);
		const existing = repository.find(planned.identity.executionPlanId);
		if (
			!force &&
			existing?.state.status === "failed" &&
			demand.taskUpdatedAtMs !== existing.state.updatedAtMs
		) {
			const failures = demand.failures + 1;
			demand = {
				...demand,
				failures,
				nextAttemptAtMs:
					Date.now() +
					Math.min(intervalMs, 60000 * 2 ** Math.min(failures - 1, 12)),
				taskUpdatedAtMs: existing.state.updatedAtMs,
			};
			repository.saveAutomaticDemand?.(demand);
			this.retryAt = Math.min(this.retryAt, demand.nextAttemptAtMs);
			return;
		}
		await resources.sources.revalidateSource(source);
		resources.sources.assertAccessRevision(source.accessRevision);
		if (
			this.closed ||
			this.selected() !== preset ||
			system.transcodeRevision !== revision
		)
			return;
		const latestStates = preset.match?.viewingStates?.length
			? await this.options.viewing([source.identity])
			: {};
		if (
			!matchesPreset(
				preset,
				source.identity,
				latestStates[fileId] ?? "unwatched",
			)
		)
			return;
		if (
			this.closed ||
			this.selected() !== preset ||
			system.transcodeRevision !== revision
		)
			return;
		const view = await preparation.createAutomatic(
			fileId,
			source.identity.sourceVersion,
			profile.id,
			planned,
			{
				origin: "automatic",
				presetId: preset.id,
				presetFingerprint: presetFingerprint(preset),
				presetSnapshot: preset,
			},
		);
		if (
			view.task.state.status === "queued" ||
			view.task.state.status === "processing"
		)
			this.retryAt = Math.min(this.retryAt, Date.now() + 60000);
		repository.saveAutomaticDemand?.({ ...demand, nextAttemptAtMs: 0 });
		return view;
	}
	private async retry(id: string): Promise<PreparationView> {
		const task = this.options.repository.get(id);
		const preset = this.selected();
		if (!task || !preset)
			throw new Error("Automatic preparation preset is unavailable.");
		const view = await this.evaluate(task.spec.source.fileId, preset, true);
		if (!view) return this.options.preparation.get(id);
		return view;
	}
	async close(): Promise<void> {
		this.closed = true;
		clearTimeout(this.timer);
		for (const unsubscribe of this.unsubscribe) unsubscribe();
		await this.running;
	}
}
