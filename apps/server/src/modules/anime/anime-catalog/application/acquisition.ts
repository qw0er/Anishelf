import { createHash } from "node:crypto";
import { DomainError } from "../../../../shared/errors.js";
import type { SourceIdentity } from "../../../resources/public.js";
import type { IdentificationResult } from "../../identification/public.js";
import type { AcquisitionProvenance } from "../../public.js";
import type { AssociationApplication } from "./associations.js";
import type { CatalogContext } from "./context.js";
import { ReviewApplication } from "./review.js";

/** An accepted download owns its target; filenames cannot revoke that decision. */
export class AcquisitionAssociation {
	constructor(
		private readonly context: CatalogContext,
		private readonly associations: AssociationApplication,
	) {}
	async reusable(
		sources: readonly SourceIdentity[],
	): Promise<IdentificationResult[]> {
		const scope = await this.context.scope();
		const results: IdentificationResult[] = [];
		for (const source of sources) {
			if (!scope.ids.includes(source.scopeId)) continue;
			const registered = this.context.options.store.registerSource(source);
			const record = this.context.options.store.review(registered.id);
			if (
				record?.decision !== "confirmed" ||
				record.decisionOrigin !== "acquisition" ||
				!record.acquisition ||
				!record.available ||
				record.sourceVersion !== source.sourceVersion ||
				!this.context.options.store.associations(record.id).length
			)
				continue;
			results.push({
				source,
				evidence: record.evidence,
				proposals: record.proposals,
				unresolved: record.unresolved,
				metadataStatus: record.metadataStatus,
				status: "unresolved",
			});
		}
		this.context.options.sources.assertAccessRevision(scope.revision);
		return results;
	}
	async associate(
		result: IdentificationResult,
		provenance: AcquisitionProvenance,
		signal: AbortSignal,
	): Promise<"available" | "review"> {
		const { options } = this.context;
		const scope = await this.context.scope();
		const identity = result.source,
			target = provenance.target;
		await options.sources.revalidateSource({
			identity,
			accessRevision: scope.revision,
		});
		const source = options.store.registerSource(identity);
		const priorVersion = options.store.priorAcquisition(
			identity.fileId,
			identity.scopeId,
		);
		if (
			priorVersion &&
			priorVersion.sourceVersion !== identity.sourceVersion &&
			priorVersion.acquisition?.intentId === provenance.intentId
		)
			return "review";
		const check = () => {
			const record = options.store.review(source.id);
			const links = options.store.associations(source.id);
			const matches =
				links.length > 0 &&
				links.every(
					(link) =>
						options.store.link(link.episode.workId)?.reference.id ===
							target.reference.id &&
						link.episode.kind === "regular" &&
						link.episode.number === String(target.episode),
				);
			if (record?.decision === "rejected") return "review" as const;
			if (matches) return "available" as const;
			if (
				(record?.decision === "confirmed" || links.length) &&
				record?.decisionOrigin !== "identification"
			)
				return "review" as const;
			if (record?.decisionOrigin === "manual") return "review" as const;
			return null;
		};
		const prior = check();
		if (prior) {
			if (prior === "available" && !options.store.review(source.id)?.available)
				new ReviewApplication(this.context).publish([result], scope.ids, [
					identity.fileId,
				]);
			return prior;
		}
		const snapshot = options.metadata.snapshot(target.snapshotId);
		if (
			snapshot.kind !== "detail" ||
			snapshot.data.reference.id !== target.reference.id
		)
			throw new DomainError(
				"ACQUISITION_CONFLICT",
				"Accepted acquisition metadata does not match the target.",
			);
		new ReviewApplication(this.context).publish([result], scope.ids, [
			identity.fileId,
		]);
		const existing = check();
		if (existing) return existing;
		const record = this.context.requireReview(source.id, scope.ids);
		const replace = options.store.associations(source.id).length > 0;
		const preview = await this.associations.preview(
			{
				reference: target.reference,
				rows: [
					{
						reviewId: record.id,
						revision: record.revision,
						targets: [{ kind: "regular", number: String(target.episode) }],
						offset: 0,
						reason:
							"Associated with the accepted Anishelf download target; filename differences are advisory.",
					},
				],
			},
			signal,
			snapshot,
		);
		try {
			signal.throwIfAborted();
			await options.sources.revalidateSource({
				identity,
				accessRevision: scope.revision,
			});
			await this.associations.confirm(
				{
					previewId: preview.id,
					operationKey: `acquisition:${createHash("sha256")
						.update(
							JSON.stringify([
								provenance.intentId,
								identity,
								target.reference,
								target.episode,
							]),
						)
						.digest("hex")}`,
					replace,
				},
				signal,
				"acquisition",
				provenance,
			);
		} finally {
			this.associations.discard(preview.id);
		}
		const confirmed = options.store.review(source.id);
		options.logger.info(
			{
				event: "catalog.acquisition_associated",
				intentId: provenance.intentId,
				sourceId: source.id,
				episode: target.episode,
				correctedAutomatic: replace,
				warnings: provenance.warnings,
			},
			"Accepted download target associated with its verified file.",
		);
		return confirmed?.decisionOrigin === "acquisition" &&
			check() === "available"
			? "available"
			: "review";
	}
}
