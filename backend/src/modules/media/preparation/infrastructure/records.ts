import { asc, eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import * as s from "./schema.js";
import type { PreparationRecord } from "./task-record.js";

export function readPreparationTasks(
	store: Store,
	row: typeof s.preparationTasks.$inferSelect,
): PreparationRecord {
	return {
		id: row.id,
		sourceId: row.sourceId,
		executionPlanId: row.executionPlanId,
		profileId: row.profileId,
		profileFingerprint: row.profileFingerprint,
		filename: row.filename,
		snapshot: {
			version: row.snapshotVersion,
			mode: row.snapshotMode,
			reasons: {
				video: row.snapshotReasonsVideo,
				audio: row.snapshotReasonsAudio,
			},
			videoStreamIndex: row.snapshotVideoStreamIndex,
			audioStreamIndices: store
				.select()
				.from(s.preparationTasksSnapshotAudioStreamIndices)
				.where(
					eq(s.preparationTasksSnapshotAudioStreamIndices.parentId, row.id),
				)
				.orderBy(asc(s.preparationTasksSnapshotAudioStreamIndices.ordinalIndex))
				.all()
				.map((child) => ({ value: child.value }))
				.map((item) => item.value),
			plan: {
				container: row.snapshotPlanContainer,
				...(row.snapshotPlanDelivery !== null
					? {
							delivery:
								row.snapshotPlanDelivery !== null
									? row.snapshotPlanDelivery
									: undefined,
						}
					: {}),
				outputFormat: row.snapshotPlanOutputFormat,
				video: {
					action: row.snapshotPlanVideoAction,
					...(row.snapshotPlanVideoEncoder !== null
						? {
								encoder:
									row.snapshotPlanVideoEncoder !== null
										? row.snapshotPlanVideoEncoder
										: undefined,
							}
						: {}),
					...(row.snapshotPlanVideoCodec !== null
						? {
								codec:
									row.snapshotPlanVideoCodec !== null
										? row.snapshotPlanVideoCodec
										: undefined,
							}
						: {}),
					...(row.snapshotPlanVideoPixelFormat !== null
						? {
								pixelFormat:
									row.snapshotPlanVideoPixelFormat !== null
										? row.snapshotPlanVideoPixelFormat
										: undefined,
							}
						: {}),
				},
				audio: {
					action: row.snapshotPlanAudioAction,
					...(row.snapshotPlanAudioEncoder !== null
						? {
								encoder:
									row.snapshotPlanAudioEncoder !== null
										? row.snapshotPlanAudioEncoder
										: undefined,
							}
						: {}),
					...(row.snapshotPlanAudioCodec !== null
						? {
								codec:
									row.snapshotPlanAudioCodec !== null
										? row.snapshotPlanAudioCodec
										: undefined,
							}
						: {}),
					...(row.snapshotPlanAudioPixelFormat !== null
						? {
								pixelFormat:
									row.snapshotPlanAudioPixelFormat !== null
										? row.snapshotPlanAudioPixelFormat
										: undefined,
							}
						: {}),
				},
				filters: store
					.select()
					.from(s.preparationTasksSnapshotPlanFilters)
					.where(eq(s.preparationTasksSnapshotPlanFilters.parentId, row.id))
					.orderBy(asc(s.preparationTasksSnapshotPlanFilters.ordinalIndex))
					.all()
					.map((child) => ({ value: child.value }))
					.map((item) => item.value),
				...(row.snapshotPlanVideoParametersPresent
					? {
							videoParameters: row.snapshotPlanVideoParametersPresent
								? {
										pixelFormat: row.snapshotPlanVideoParametersPixelFormat,
										...(row.snapshotPlanVideoParametersMaxHeight !== null
											? {
													maxHeight:
														row.snapshotPlanVideoParametersMaxHeight !== null
															? row.snapshotPlanVideoParametersMaxHeight
															: undefined,
												}
											: {}),
										encoder: row.snapshotPlanVideoParametersEncoder,
										codec: row.snapshotPlanVideoParametersCodec,
										...(row.snapshotPlanVideoParametersCrf !== null
											? {
													crf:
														row.snapshotPlanVideoParametersCrf !== null
															? row.snapshotPlanVideoParametersCrf
															: undefined,
												}
											: {}),
										...(row.snapshotPlanVideoParametersPreset !== null
											? {
													preset:
														row.snapshotPlanVideoParametersPreset !== null
															? row.snapshotPlanVideoParametersEncoder ===
																"libsvtav1"
																? Number(row.snapshotPlanVideoParametersPreset)
																: row.snapshotPlanVideoParametersPreset
															: undefined,
												}
											: {}),
										...(row.snapshotPlanVideoParametersCpuUsed !== null
											? {
													cpuUsed:
														row.snapshotPlanVideoParametersCpuUsed !== null
															? row.snapshotPlanVideoParametersCpuUsed
															: undefined,
												}
											: {}),
										...(row.snapshotPlanVideoParametersBitrateKbps !== null
											? {
													bitrateKbps:
														row.snapshotPlanVideoParametersBitrateKbps !== null
															? row.snapshotPlanVideoParametersBitrateKbps
															: undefined,
												}
											: {}),
									}
								: undefined,
						}
					: {}),
				...(row.snapshotPlanAudioParametersPresent
					? {
							audioParameters: row.snapshotPlanAudioParametersPresent
								? {
										channels: row.snapshotPlanAudioParametersChannels,
										encoder: row.snapshotPlanAudioParametersEncoder,
										codec: row.snapshotPlanAudioParametersCodec,
										...(row.snapshotPlanAudioParametersBitrateKbps !== null
											? {
													bitrateKbps:
														row.snapshotPlanAudioParametersBitrateKbps !== null
															? row.snapshotPlanAudioParametersBitrateKbps
															: undefined,
												}
											: {}),
										...(row.snapshotPlanAudioParametersCompressionLevel !== null
											? {
													compressionLevel:
														row.snapshotPlanAudioParametersCompressionLevel !==
														null
															? row.snapshotPlanAudioParametersCompressionLevel
															: undefined,
												}
											: {}),
									}
								: undefined,
						}
					: {}),
				...(row.snapshotPlanVideoFiltersPresent
					? {
							videoFilters: row.snapshotPlanVideoFiltersPresent
								? store
										.select()
										.from(s.preparationTasksSnapshotPlanVideoFilters)
										.where(
											eq(
												s.preparationTasksSnapshotPlanVideoFilters.parentId,
												row.id,
											),
										)
										.orderBy(
											asc(
												s.preparationTasksSnapshotPlanVideoFilters.ordinalIndex,
											),
										)
										.all()
										.map((child) => ({ value: child.value }))
										.map((item) => item.value)
								: undefined,
						}
					: {}),
				...(row.snapshotPlanH264Level !== null
					? {
							h264Level:
								row.snapshotPlanH264Level !== null
									? row.snapshotPlanH264Level
									: undefined,
						}
					: {}),
			},
		},
		status: row.status,
		progress: row.progressPresent
			? {
					mediaTimeMs: row.progressMediaTimeMs,
					frames: row.progressFrames,
					outputBytes: row.progressOutputBytes,
					speed: row.progressSpeed,
					percent: row.progressPercent,
					ended: row.progressEnded,
				}
			: null,
		failureReason: row.failureReason,
		createdAtMs: row.createdAtMs,
		updatedAtMs: row.updatedAtMs,
	} as PreparationRecord;
}

export function writePreparationTasks(
	connection: Store,
	value: PreparationRecord,
): void {
	connection.transaction((store) => {
		const video = value.snapshot.plan.video;
		const audio = value.snapshot.plan.audio;
		const videoParameters = value.snapshot.plan.videoParameters;
		const audioParameters = value.snapshot.plan.audioParameters;
		const row0 = {
			id: value?.id,
			sourceId: value?.sourceId,
			executionPlanId: value?.executionPlanId,
			profileId: value?.profileId,
			profileFingerprint: value?.profileFingerprint,
			filename: value?.filename,
			snapshotVersion: value?.snapshot?.version,
			snapshotMode: value?.snapshot?.mode,
			snapshotReasonsVideo: value?.snapshot?.reasons?.video,
			snapshotReasonsAudio: value?.snapshot?.reasons?.audio,
			snapshotVideoStreamIndex: value?.snapshot?.videoStreamIndex,
			snapshotPlanContainer: value?.snapshot?.plan?.container,
			snapshotPlanDelivery: value?.snapshot?.plan?.delivery ?? null,
			snapshotPlanOutputFormat: value?.snapshot?.plan?.outputFormat,
			snapshotPlanVideoAction: value?.snapshot?.plan?.video?.action,
			snapshotPlanVideoEncoder:
				(video && "encoder" in video ? video.encoder : undefined) ?? null,
			snapshotPlanVideoCodec:
				(video && "codec" in video ? video.codec : undefined) ?? null,
			snapshotPlanVideoPixelFormat:
				(video && "pixelFormat" in video ? video.pixelFormat : undefined) ??
				null,
			snapshotPlanAudioAction: value?.snapshot?.plan?.audio?.action,
			snapshotPlanAudioEncoder:
				(audio && "encoder" in audio ? audio.encoder : undefined) ?? null,
			snapshotPlanAudioCodec:
				(audio && "codec" in audio ? audio.codec : undefined) ?? null,
			snapshotPlanAudioPixelFormat:
				(audio && "pixelFormat" in audio ? audio.pixelFormat : undefined) ??
				null,
			snapshotPlanVideoParametersPresent:
				value?.snapshot?.plan?.videoParameters !== null &&
				value?.snapshot?.plan?.videoParameters !== undefined,
			snapshotPlanVideoParametersPixelFormat:
				value?.snapshot?.plan?.videoParameters?.pixelFormat ?? null,
			snapshotPlanVideoParametersMaxHeight:
				value?.snapshot?.plan?.videoParameters?.maxHeight ?? null,
			snapshotPlanVideoParametersEncoder:
				value?.snapshot?.plan?.videoParameters?.encoder ?? null,
			snapshotPlanVideoParametersCodec:
				value?.snapshot?.plan?.videoParameters?.codec ?? null,
			snapshotPlanVideoParametersCrf:
				(videoParameters && "crf" in videoParameters
					? videoParameters.crf
					: undefined) ?? null,
			snapshotPlanVideoParametersPreset:
				(videoParameters && "preset" in videoParameters
					? videoParameters.preset
					: undefined) === undefined
					? null
					: String(
							videoParameters && "preset" in videoParameters
								? videoParameters.preset
								: undefined,
						),
			snapshotPlanVideoParametersCpuUsed:
				(videoParameters && "cpuUsed" in videoParameters
					? videoParameters.cpuUsed
					: undefined) ?? null,
			snapshotPlanVideoParametersBitrateKbps:
				(videoParameters && "bitrateKbps" in videoParameters
					? videoParameters.bitrateKbps
					: undefined) ?? null,
			snapshotPlanAudioParametersPresent:
				value?.snapshot?.plan?.audioParameters !== null &&
				value?.snapshot?.plan?.audioParameters !== undefined,
			snapshotPlanAudioParametersChannels:
				value?.snapshot?.plan?.audioParameters?.channels ?? null,
			snapshotPlanAudioParametersEncoder:
				value?.snapshot?.plan?.audioParameters?.encoder ?? null,
			snapshotPlanAudioParametersCodec:
				value?.snapshot?.plan?.audioParameters?.codec ?? null,
			snapshotPlanAudioParametersBitrateKbps:
				(audioParameters && "bitrateKbps" in audioParameters
					? audioParameters.bitrateKbps
					: undefined) ?? null,
			snapshotPlanAudioParametersCompressionLevel:
				(audioParameters && "compressionLevel" in audioParameters
					? audioParameters.compressionLevel
					: undefined) ?? null,
			snapshotPlanVideoFiltersPresent:
				value?.snapshot?.plan?.videoFilters !== null &&
				value?.snapshot?.plan?.videoFilters !== undefined,
			snapshotPlanH264Level: value?.snapshot?.plan?.h264Level ?? null,
			status: value?.status,
			progressPresent:
				value?.progress !== null && value?.progress !== undefined,
			progressMediaTimeMs: value?.progress?.mediaTimeMs ?? null,
			progressFrames: value?.progress?.frames ?? null,
			progressOutputBytes: value?.progress?.outputBytes ?? null,
			progressSpeed: value?.progress?.speed ?? null,
			progressPercent: value?.progress?.percent ?? null,
			progressEnded: value?.progress?.ended ?? null,
			failureReason: value?.failureReason ?? null,
			createdAtMs: value?.createdAtMs,
			updatedAtMs: value?.updatedAtMs,
		};
		store
			.insert(s.preparationTasks)
			.values(row0)
			.onConflictDoUpdate({ target: s.preparationTasks.id, set: row0 })
			.run();
		store
			.delete(s.preparationTasksSnapshotAudioStreamIndices)
			.where(
				eq(s.preparationTasksSnapshotAudioStreamIndices.parentId, value.id),
			)
			.run();
		for (const [index1, item1] of (
			value?.snapshot?.audioStreamIndices ?? []
		).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				value: { value: item1 }?.value,
			};
			store
				.insert(s.preparationTasksSnapshotAudioStreamIndices)
				.values(row1)
				.run();
		}
		store
			.delete(s.preparationTasksSnapshotPlanFilters)
			.where(eq(s.preparationTasksSnapshotPlanFilters.parentId, value.id))
			.run();
		for (const [index1, item1] of (
			value?.snapshot?.plan?.filters ?? []
		).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				value: { value: item1 }?.value,
			};
			store.insert(s.preparationTasksSnapshotPlanFilters).values(row1).run();
		}
		store
			.delete(s.preparationTasksSnapshotPlanVideoFilters)
			.where(eq(s.preparationTasksSnapshotPlanVideoFilters.parentId, value.id))
			.run();
		for (const [index1, item1] of (
			value?.snapshot?.plan?.videoFilters ?? []
		).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				value: { value: item1 }?.value,
			};
			store
				.insert(s.preparationTasksSnapshotPlanVideoFilters)
				.values(row1)
				.run();
		}
	});
}
