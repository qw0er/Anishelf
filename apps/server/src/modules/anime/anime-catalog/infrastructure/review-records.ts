import { asc, eq } from "drizzle-orm";
import type { Store } from "../../../../platform/database/store.js";
import type { IdentificationResult } from "../../identification/public.js";
import type { AcquisitionProvenance } from "../../public.js";
import * as s from "./schema.js";

export function readCatalogReviews(
	store: Store,
	row: typeof s.catalogReviews.$inferSelect,
): {
	id: string;
	available: boolean;
	revision: number;
	decisionOrigin?: "manual" | "identification" | "acquisition" | "legacy";
	acquisition?: AcquisitionProvenance | null;
	decision: "pending" | "confirmed" | "rejected";
	reason: string | null;
	result: Omit<IdentificationResult, "source">;
} {
	return {
		id: row.id,
		available: row.available,
		revision: row.revision,
		decision: row.decision,
		decisionOrigin: row.decisionOrigin,
		acquisition: row.acquisition,
		reason: row.reason,
		result: {
			evidence: {
				parser: row.resultEvidenceParser,
				parserVersion: row.resultEvidenceParserVersion,
				normalizationVersion: row.resultEvidenceNormalizationVersion,
				contextFingerprint: row.resultEvidenceContextFingerprint,
				originalName: row.resultEvidenceOriginalName,
				relativePath: row.resultEvidenceRelativePath,
				inputs: store
					.select()
					.from(s.catalogReviewsResultEvidenceInputs)
					.where(eq(s.catalogReviewsResultEvidenceInputs.parentId, row.id))
					.orderBy(asc(s.catalogReviewsResultEvidenceInputs.ordinalIndex))
					.all()
					.map((child) => ({
						mode: child.mode,
						input: child.input,
						elements: store
							.select()
							.from(s.catalogReviewsResultEvidenceInputsElements)
							.where(
								eq(
									s.catalogReviewsResultEvidenceInputsElements.parentId,
									child.rowId,
								),
							)
							.orderBy(
								asc(s.catalogReviewsResultEvidenceInputsElements.ordinalIndex),
							)
							.all()
							.map((child) => ({
								kind: child.kind,
								value: child.value,
								position: child.position,
							})),
					})),
				titles: store
					.select()
					.from(s.catalogReviewsResultEvidenceTitles)
					.where(eq(s.catalogReviewsResultEvidenceTitles.parentId, row.id))
					.orderBy(asc(s.catalogReviewsResultEvidenceTitles.ordinalIndex))
					.all()
					.map((child) => ({ value: child.value }))
					.map((item) => item.value),
				...(row.resultEvidenceTitleSourcesPresent
					? {
							titleSources: row.resultEvidenceTitleSourcesPresent
								? store
										.select()
										.from(s.catalogReviewsResultEvidenceTitleSources)
										.where(
											eq(
												s.catalogReviewsResultEvidenceTitleSources.parentId,
												row.id,
											),
										)
										.orderBy(
											asc(
												s.catalogReviewsResultEvidenceTitleSources.ordinalIndex,
											),
										)
										.all()
										.map((child) => ({
											title: child.title,
											mode: child.mode,
											distance: child.distance,
										}))
								: undefined,
						}
					: {}),
				years: store
					.select()
					.from(s.catalogReviewsResultEvidenceYears)
					.where(eq(s.catalogReviewsResultEvidenceYears.parentId, row.id))
					.orderBy(asc(s.catalogReviewsResultEvidenceYears.ordinalIndex))
					.all()
					.map((child) => ({ value: child.value }))
					.map((item) => item.value),
				seasons: store
					.select()
					.from(s.catalogReviewsResultEvidenceSeasons)
					.where(eq(s.catalogReviewsResultEvidenceSeasons.parentId, row.id))
					.orderBy(asc(s.catalogReviewsResultEvidenceSeasons.ordinalIndex))
					.all()
					.map((child) => ({ value: child.value }))
					.map((item) => item.value),
				parts: store
					.select()
					.from(s.catalogReviewsResultEvidenceParts)
					.where(eq(s.catalogReviewsResultEvidenceParts.parentId, row.id))
					.orderBy(asc(s.catalogReviewsResultEvidenceParts.ordinalIndex))
					.all()
					.map((child) => ({ value: child.value }))
					.map((item) => item.value),
				rawEpisodes: store
					.select()
					.from(s.catalogReviewsResultEvidenceRawEpisodes)
					.where(eq(s.catalogReviewsResultEvidenceRawEpisodes.parentId, row.id))
					.orderBy(asc(s.catalogReviewsResultEvidenceRawEpisodes.ordinalIndex))
					.all()
					.map((child) => ({ value: child.value }))
					.map((item) => item.value),
				...(row.resultEvidenceSelectedEpisodesPresent
					? {
							selectedEpisodes: row.resultEvidenceSelectedEpisodesPresent
								? store
										.select()
										.from(s.catalogReviewsResultEvidenceSelectedEpisodes)
										.where(
											eq(
												s.catalogReviewsResultEvidenceSelectedEpisodes.parentId,
												row.id,
											),
										)
										.orderBy(
											asc(
												s.catalogReviewsResultEvidenceSelectedEpisodes
													.ordinalIndex,
											),
										)
										.all()
										.map((child) => ({ value: child.value }))
										.map((item) => item.value)
								: undefined,
						}
					: {}),
				numbering: row.resultEvidenceNumbering,
				contentKind: row.resultEvidenceContentKind,
			},
			status: row.resultStatus,
			metadataStatus: row.resultMetadataStatus,
			proposals: store
				.select()
				.from(s.catalogReviewsResultProposals)
				.where(eq(s.catalogReviewsResultProposals.parentId, row.id))
				.orderBy(asc(s.catalogReviewsResultProposals.ordinalIndex))
				.all()
				.map((child) => ({
					candidate: {
						work: {
							reference: {
								id: child.candidateWorkReferenceId,
							},
							snapshotId: child.candidateWorkSnapshotId,
							titles: store
								.select()
								.from(s.catalogReviewsResultProposalsCandidateWorkTitles)
								.where(
									eq(
										s.catalogReviewsResultProposalsCandidateWorkTitles.parentId,
										child.rowId,
									),
								)
								.orderBy(
									asc(
										s.catalogReviewsResultProposalsCandidateWorkTitles
											.ordinalIndex,
									),
								)
								.all()
								.map((child) => ({ value: child.value }))
								.map((item) => item.value),
							...(child.candidateWorkTitleVariantsPresent
								? {
										titleVariants: child.candidateWorkTitleVariantsPresent
											? store
													.select()
													.from(
														s.catalogReviewsResultProposalsCandidateWorkTitleVariants,
													)
													.where(
														eq(
															s
																.catalogReviewsResultProposalsCandidateWorkTitleVariants
																.parentId,
															child.rowId,
														),
													)
													.orderBy(
														asc(
															s
																.catalogReviewsResultProposalsCandidateWorkTitleVariants
																.ordinalIndex,
														),
													)
													.all()
													.map((child) => ({
														value: child.value,
														kind: child.kind,
														language: child.language,
													}))
											: undefined,
									}
								: {}),
							year: child.candidateWorkYear,
							format: child.candidateWorkFormat,
							episodeCount: child.candidateWorkEpisodeCount,
							season: child.candidateWorkSeason,
							part: child.candidateWorkPart,
							...(child.candidateWorkOrdinalSource !== null
								? {
										ordinalSource:
											child.candidateWorkOrdinalSource !== null
												? child.candidateWorkOrdinalSource
												: undefined,
									}
								: {}),
						},
						score: child.candidateScore,
						reasons: store
							.select()
							.from(s.catalogReviewsResultProposalsCandidateReasons)
							.where(
								eq(
									s.catalogReviewsResultProposalsCandidateReasons.parentId,
									child.rowId,
								),
							)
							.orderBy(
								asc(
									s.catalogReviewsResultProposalsCandidateReasons.ordinalIndex,
								),
							)
							.all()
							.map((child) => ({ value: child.value }))
							.map((item) => item.value),
						conflicts: store
							.select()
							.from(s.catalogReviewsResultProposalsCandidateConflicts)
							.where(
								eq(
									s.catalogReviewsResultProposalsCandidateConflicts.parentId,
									child.rowId,
								),
							)
							.orderBy(
								asc(
									s.catalogReviewsResultProposalsCandidateConflicts
										.ordinalIndex,
								),
							)
							.all()
							.map((child) => ({ value: child.value }))
							.map((item) => item.value),
						...(child.candidateIdentityConflictsPresent
							? {
									identityConflicts: child.candidateIdentityConflictsPresent
										? store
												.select()
												.from(
													s.catalogReviewsResultProposalsCandidateIdentityConflicts,
												)
												.where(
													eq(
														s
															.catalogReviewsResultProposalsCandidateIdentityConflicts
															.parentId,
														child.rowId,
													),
												)
												.orderBy(
													asc(
														s
															.catalogReviewsResultProposalsCandidateIdentityConflicts
															.ordinalIndex,
													),
												)
												.all()
												.map((child) => ({ value: child.value }))
												.map((item) => item.value)
										: undefined,
								}
							: {}),
						...(child.candidateIdentityUnresolvedPresent
							? {
									identityUnresolved: child.candidateIdentityUnresolvedPresent
										? store
												.select()
												.from(
													s.catalogReviewsResultProposalsCandidateIdentityUnresolved,
												)
												.where(
													eq(
														s
															.catalogReviewsResultProposalsCandidateIdentityUnresolved
															.parentId,
														child.rowId,
													),
												)
												.orderBy(
													asc(
														s
															.catalogReviewsResultProposalsCandidateIdentityUnresolved
															.ordinalIndex,
													),
												)
												.all()
												.map((child) => ({ value: child.value }))
												.map((item) => item.value)
										: undefined,
								}
							: {}),
						...(child.candidateAssumptionsPresent
							? {
									assumptions: child.candidateAssumptionsPresent
										? store
												.select()
												.from(
													s.catalogReviewsResultProposalsCandidateAssumptions,
												)
												.where(
													eq(
														s.catalogReviewsResultProposalsCandidateAssumptions
															.parentId,
														child.rowId,
													),
												)
												.orderBy(
													asc(
														s.catalogReviewsResultProposalsCandidateAssumptions
															.ordinalIndex,
													),
												)
												.all()
												.map((child) => ({ value: child.value }))
												.map((item) => item.value)
										: undefined,
								}
							: {}),
						matcherVersion: child.candidateMatcherVersion,
					},
					mapping: {
						targets: store
							.select()
							.from(s.catalogReviewsResultProposalsMappingTargets)
							.where(
								eq(
									s.catalogReviewsResultProposalsMappingTargets.parentId,
									child.rowId,
								),
							)
							.orderBy(
								asc(s.catalogReviewsResultProposalsMappingTargets.ordinalIndex),
							)
							.all()
							.map((child) => ({ kind: child.kind, number: child.number })),
						reasons: store
							.select()
							.from(s.catalogReviewsResultProposalsMappingReasons)
							.where(
								eq(
									s.catalogReviewsResultProposalsMappingReasons.parentId,
									child.rowId,
								),
							)
							.orderBy(
								asc(s.catalogReviewsResultProposalsMappingReasons.ordinalIndex),
							)
							.all()
							.map((child) => ({ value: child.value }))
							.map((item) => item.value),
						unresolved: store
							.select()
							.from(s.catalogReviewsResultProposalsMappingUnresolved)
							.where(
								eq(
									s.catalogReviewsResultProposalsMappingUnresolved.parentId,
									child.rowId,
								),
							)
							.orderBy(
								asc(
									s.catalogReviewsResultProposalsMappingUnresolved.ordinalIndex,
								),
							)
							.all()
							.map((child) => ({ value: child.value }))
							.map((item) => item.value),
						...(child.mappingNumberingPresent
							? {
									numbering: child.mappingNumberingPresent
										? {
												source: child.mappingNumberingSource,
												offset: child.mappingNumberingOffset,
												anchors: store
													.select()
													.from(
														s.catalogReviewsResultProposalsMappingNumberingAnchors,
													)
													.where(
														eq(
															s
																.catalogReviewsResultProposalsMappingNumberingAnchors
																.parentId,
															child.rowId,
														),
													)
													.orderBy(
														asc(
															s
																.catalogReviewsResultProposalsMappingNumberingAnchors
																.ordinalIndex,
														),
													)
													.all()
													.map((child) => ({
														fileId: child.fileId,
														sourceVersion: child.sourceVersion,
													})),
											}
										: undefined,
								}
							: {}),
					},
				})),
			unresolved: store
				.select()
				.from(s.catalogReviewsResultUnresolved)
				.where(eq(s.catalogReviewsResultUnresolved.parentId, row.id))
				.orderBy(asc(s.catalogReviewsResultUnresolved.ordinalIndex))
				.all()
				.map((child) => ({ value: child.value }))
				.map((item) => item.value),
		},
	} as {
		id: string;
		available: boolean;
		revision: number;
		decisionOrigin?: "manual" | "identification" | "acquisition" | "legacy";
		acquisition?: AcquisitionProvenance | null;
		decision: "pending" | "confirmed" | "rejected";
		reason: string | null;
		result: Omit<IdentificationResult, "source">;
	};
}

export function writeCatalogReviews(
	connection: Store,
	value: {
		id: string;
		available: boolean;
		revision: number;
		decisionOrigin?: "manual" | "identification" | "acquisition" | "legacy";
		acquisition?: AcquisitionProvenance | null;
		decision: "pending" | "confirmed" | "rejected";
		reason: string | null;
		result: Omit<IdentificationResult, "source">;
	},
): void {
	connection.transaction((store) => {
		const row0 = {
			id: value?.id,
			available: value?.available,
			revision: value?.revision,
			decision: value?.decision,
			decisionOrigin: value.decisionOrigin ?? "legacy",
			acquisition: value.acquisition ?? null,
			reason: value?.reason ?? null,
			resultEvidenceParser: value?.result?.evidence?.parser,
			resultEvidenceParserVersion: value?.result?.evidence?.parserVersion,
			resultEvidenceNormalizationVersion:
				value?.result?.evidence?.normalizationVersion,
			resultEvidenceContextFingerprint:
				value?.result?.evidence?.contextFingerprint,
			resultEvidenceOriginalName: value?.result?.evidence?.originalName,
			resultEvidenceRelativePath: value?.result?.evidence?.relativePath,
			resultEvidenceTitleSourcesPresent:
				value?.result?.evidence?.titleSources !== null &&
				value?.result?.evidence?.titleSources !== undefined,
			resultEvidenceSelectedEpisodesPresent:
				value?.result?.evidence?.selectedEpisodes !== null &&
				value?.result?.evidence?.selectedEpisodes !== undefined,
			resultEvidenceNumbering: value?.result?.evidence?.numbering,
			resultEvidenceContentKind: value?.result?.evidence?.contentKind,
			resultStatus: value?.result?.status,
			resultMetadataStatus: value?.result?.metadataStatus,
		};
		store
			.insert(s.catalogReviews)
			.values(row0)
			.onConflictDoUpdate({ target: s.catalogReviews.id, set: row0 })
			.run();
		store
			.delete(s.catalogReviewsResultEvidenceInputs)
			.where(eq(s.catalogReviewsResultEvidenceInputs.parentId, value.id))
			.run();
		for (const [index1, item1] of (
			value?.result?.evidence?.inputs ?? []
		).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				mode: item1?.mode,
				input: item1?.input,
			};
			store.insert(s.catalogReviewsResultEvidenceInputs).values(row1).run();
			store
				.delete(s.catalogReviewsResultEvidenceInputsElements)
				.where(eq(s.catalogReviewsResultEvidenceInputsElements.parentId, id1))
				.run();
			for (const [index2, item2] of (item1?.elements ?? []).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					kind: item2?.kind,
					value: item2?.value,
					position: item2?.position,
				};
				store
					.insert(s.catalogReviewsResultEvidenceInputsElements)
					.values(row2)
					.run();
			}
		}
		store
			.delete(s.catalogReviewsResultEvidenceTitles)
			.where(eq(s.catalogReviewsResultEvidenceTitles.parentId, value.id))
			.run();
		for (const [index1, item1] of (
			value?.result?.evidence?.titles ?? []
		).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				value: { value: item1 }?.value,
			};
			store.insert(s.catalogReviewsResultEvidenceTitles).values(row1).run();
		}
		store
			.delete(s.catalogReviewsResultEvidenceTitleSources)
			.where(eq(s.catalogReviewsResultEvidenceTitleSources.parentId, value.id))
			.run();
		for (const [index1, item1] of (
			value?.result?.evidence?.titleSources ?? []
		).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				title: item1?.title,
				mode: item1?.mode,
				distance: item1?.distance,
			};
			store
				.insert(s.catalogReviewsResultEvidenceTitleSources)
				.values(row1)
				.run();
		}
		store
			.delete(s.catalogReviewsResultEvidenceYears)
			.where(eq(s.catalogReviewsResultEvidenceYears.parentId, value.id))
			.run();
		for (const [index1, item1] of (
			value?.result?.evidence?.years ?? []
		).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				value: { value: item1 }?.value,
			};
			store.insert(s.catalogReviewsResultEvidenceYears).values(row1).run();
		}
		store
			.delete(s.catalogReviewsResultEvidenceSeasons)
			.where(eq(s.catalogReviewsResultEvidenceSeasons.parentId, value.id))
			.run();
		for (const [index1, item1] of (
			value?.result?.evidence?.seasons ?? []
		).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				value: { value: item1 }?.value,
			};
			store.insert(s.catalogReviewsResultEvidenceSeasons).values(row1).run();
		}
		store
			.delete(s.catalogReviewsResultEvidenceParts)
			.where(eq(s.catalogReviewsResultEvidenceParts.parentId, value.id))
			.run();
		for (const [index1, item1] of (
			value?.result?.evidence?.parts ?? []
		).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				value: { value: item1 }?.value,
			};
			store.insert(s.catalogReviewsResultEvidenceParts).values(row1).run();
		}
		store
			.delete(s.catalogReviewsResultEvidenceRawEpisodes)
			.where(eq(s.catalogReviewsResultEvidenceRawEpisodes.parentId, value.id))
			.run();
		for (const [index1, item1] of (
			value?.result?.evidence?.rawEpisodes ?? []
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
				.insert(s.catalogReviewsResultEvidenceRawEpisodes)
				.values(row1)
				.run();
		}
		store
			.delete(s.catalogReviewsResultEvidenceSelectedEpisodes)
			.where(
				eq(s.catalogReviewsResultEvidenceSelectedEpisodes.parentId, value.id),
			)
			.run();
		for (const [index1, item1] of (
			value?.result?.evidence?.selectedEpisodes ?? []
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
				.insert(s.catalogReviewsResultEvidenceSelectedEpisodes)
				.values(row1)
				.run();
		}
		store
			.delete(s.catalogReviewsResultProposals)
			.where(eq(s.catalogReviewsResultProposals.parentId, value.id))
			.run();
		for (const [index1, item1] of (value?.result?.proposals ?? []).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				candidateWorkReferenceId: item1?.candidate?.work?.reference?.id,
				candidateWorkSnapshotId: item1?.candidate?.work?.snapshotId,
				candidateWorkTitleVariantsPresent:
					item1?.candidate?.work?.titleVariants !== null &&
					item1?.candidate?.work?.titleVariants !== undefined,
				candidateWorkYear: item1?.candidate?.work?.year ?? null,
				candidateWorkFormat: item1?.candidate?.work?.format ?? null,
				candidateWorkEpisodeCount: item1?.candidate?.work?.episodeCount ?? null,
				candidateWorkSeason: item1?.candidate?.work?.season ?? null,
				candidateWorkPart: item1?.candidate?.work?.part ?? null,
				candidateWorkOrdinalSource:
					item1?.candidate?.work?.ordinalSource ?? null,
				candidateScore: item1?.candidate?.score,
				candidateIdentityConflictsPresent:
					item1?.candidate?.identityConflicts !== null &&
					item1?.candidate?.identityConflicts !== undefined,
				candidateIdentityUnresolvedPresent:
					item1?.candidate?.identityUnresolved !== null &&
					item1?.candidate?.identityUnresolved !== undefined,
				candidateAssumptionsPresent:
					item1?.candidate?.assumptions !== null &&
					item1?.candidate?.assumptions !== undefined,
				candidateMatcherVersion: item1?.candidate?.matcherVersion,
				mappingNumberingPresent:
					item1?.mapping?.numbering !== null &&
					item1?.mapping?.numbering !== undefined,
				mappingNumberingSource: item1?.mapping?.numbering?.source ?? null,
				mappingNumberingOffset: item1?.mapping?.numbering?.offset ?? null,
			};
			store.insert(s.catalogReviewsResultProposals).values(row1).run();
			store
				.delete(s.catalogReviewsResultProposalsCandidateWorkTitles)
				.where(
					eq(s.catalogReviewsResultProposalsCandidateWorkTitles.parentId, id1),
				)
				.run();
			for (const [index2, item2] of (
				item1?.candidate?.work?.titles ?? []
			).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					value: { value: item2 }?.value,
				};
				store
					.insert(s.catalogReviewsResultProposalsCandidateWorkTitles)
					.values(row2)
					.run();
			}
			store
				.delete(s.catalogReviewsResultProposalsCandidateWorkTitleVariants)
				.where(
					eq(
						s.catalogReviewsResultProposalsCandidateWorkTitleVariants.parentId,
						id1,
					),
				)
				.run();
			for (const [index2, item2] of (
				item1?.candidate?.work?.titleVariants ?? []
			).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					value: item2?.value,
					kind: item2?.kind,
					language: item2?.language ?? null,
				};
				store
					.insert(s.catalogReviewsResultProposalsCandidateWorkTitleVariants)
					.values(row2)
					.run();
			}
			store
				.delete(s.catalogReviewsResultProposalsCandidateReasons)
				.where(
					eq(s.catalogReviewsResultProposalsCandidateReasons.parentId, id1),
				)
				.run();
			for (const [index2, item2] of (
				item1?.candidate?.reasons ?? []
			).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					value: { value: item2 }?.value,
				};
				store
					.insert(s.catalogReviewsResultProposalsCandidateReasons)
					.values(row2)
					.run();
			}
			store
				.delete(s.catalogReviewsResultProposalsCandidateConflicts)
				.where(
					eq(s.catalogReviewsResultProposalsCandidateConflicts.parentId, id1),
				)
				.run();
			for (const [index2, item2] of (
				item1?.candidate?.conflicts ?? []
			).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					value: { value: item2 }?.value,
				};
				store
					.insert(s.catalogReviewsResultProposalsCandidateConflicts)
					.values(row2)
					.run();
			}
			store
				.delete(s.catalogReviewsResultProposalsCandidateIdentityConflicts)
				.where(
					eq(
						s.catalogReviewsResultProposalsCandidateIdentityConflicts.parentId,
						id1,
					),
				)
				.run();
			for (const [index2, item2] of (
				item1?.candidate?.identityConflicts ?? []
			).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					value: { value: item2 }?.value,
				};
				store
					.insert(s.catalogReviewsResultProposalsCandidateIdentityConflicts)
					.values(row2)
					.run();
			}
			store
				.delete(s.catalogReviewsResultProposalsCandidateIdentityUnresolved)
				.where(
					eq(
						s.catalogReviewsResultProposalsCandidateIdentityUnresolved.parentId,
						id1,
					),
				)
				.run();
			for (const [index2, item2] of (
				item1?.candidate?.identityUnresolved ?? []
			).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					value: { value: item2 }?.value,
				};
				store
					.insert(s.catalogReviewsResultProposalsCandidateIdentityUnresolved)
					.values(row2)
					.run();
			}
			store
				.delete(s.catalogReviewsResultProposalsCandidateAssumptions)
				.where(
					eq(s.catalogReviewsResultProposalsCandidateAssumptions.parentId, id1),
				)
				.run();
			for (const [index2, item2] of (
				item1?.candidate?.assumptions ?? []
			).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					value: { value: item2 }?.value,
				};
				store
					.insert(s.catalogReviewsResultProposalsCandidateAssumptions)
					.values(row2)
					.run();
			}
			store
				.delete(s.catalogReviewsResultProposalsMappingTargets)
				.where(eq(s.catalogReviewsResultProposalsMappingTargets.parentId, id1))
				.run();
			for (const [index2, item2] of (item1?.mapping?.targets ?? []).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					kind: item2?.kind,
					number: item2?.number,
				};
				store
					.insert(s.catalogReviewsResultProposalsMappingTargets)
					.values(row2)
					.run();
			}
			store
				.delete(s.catalogReviewsResultProposalsMappingReasons)
				.where(eq(s.catalogReviewsResultProposalsMappingReasons.parentId, id1))
				.run();
			for (const [index2, item2] of (item1?.mapping?.reasons ?? []).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					value: { value: item2 }?.value,
				};
				store
					.insert(s.catalogReviewsResultProposalsMappingReasons)
					.values(row2)
					.run();
			}
			store
				.delete(s.catalogReviewsResultProposalsMappingUnresolved)
				.where(
					eq(s.catalogReviewsResultProposalsMappingUnresolved.parentId, id1),
				)
				.run();
			for (const [index2, item2] of (
				item1?.mapping?.unresolved ?? []
			).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					value: { value: item2 }?.value,
				};
				store
					.insert(s.catalogReviewsResultProposalsMappingUnresolved)
					.values(row2)
					.run();
			}
			store
				.delete(s.catalogReviewsResultProposalsMappingNumberingAnchors)
				.where(
					eq(
						s.catalogReviewsResultProposalsMappingNumberingAnchors.parentId,
						id1,
					),
				)
				.run();
			for (const [index2, item2] of (
				item1?.mapping?.numbering?.anchors ?? []
			).entries()) {
				const parent2 = id1;
				const id2 = `${parent2}/${index2}`;
				const row2 = {
					rowId: id2,
					parentId: parent2,
					ordinalIndex: index2,
					fileId: item2?.fileId,
					sourceVersion: item2?.sourceVersion,
				};
				store
					.insert(s.catalogReviewsResultProposalsMappingNumberingAnchors)
					.values(row2)
					.run();
			}
		}
		store
			.delete(s.catalogReviewsResultUnresolved)
			.where(eq(s.catalogReviewsResultUnresolved.parentId, value.id))
			.run();
		for (const [index1, item1] of (value?.result?.unresolved ?? []).entries()) {
			const parent1 = value.id;
			const id1 = `${parent1}/${index1}`;
			const row1 = {
				rowId: id1,
				parentId: parent1,
				ordinalIndex: index1,
				value: { value: item1 }?.value,
			};
			store.insert(s.catalogReviewsResultUnresolved).values(row1).run();
		}
	});
}
