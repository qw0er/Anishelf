import { createHash } from "node:crypto";
import { DomainError } from "../../../../shared/errors.js";
import type { SourceIdentity } from "../../../resources/public.js";
import type { IdentificationResult } from "../../identification/public.js";
import type {
	AcceptedAcquisitionTarget,
	AcquisitionCommitGuard,
	AcquisitionProvenance,
	AcquisitionReview,
} from "../../public.js";
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
		guard?: AcquisitionCommitGuard,
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
		) {
			new ReviewApplication(this.context).publish(
				[
					{
						...result,
						unresolved: [
							...new Set([...result.unresolved, "download_target_conflict"]),
						],
					},
				],
				scope.ids,
				[identity.fileId],
			);
			return "review";
		}
		const check = () => {
			const record = options.store.review(source.id);
			const links = options.store.associations(source.id);
			if (record?.decision === "rejected") return "review" as const;
			if (this.matchesTarget(links, target)) return "available" as const;
			if (
				(record?.decision === "confirmed" || links.length) &&
				record?.decisionOrigin !== "identification"
			)
				return "review" as const;
			if (record?.decisionOrigin === "manual") return "review" as const;
			return null;
		};
		const checkAfterVerification = async () => {
			if (guard) {
				await guard.verify();
				guard.assertCurrent();
				options.sources.assertAccessRevision(scope.revision);
			}
			return check() === "available" ? "available" : "review";
		};
		const prior = check();
		if (prior) {
			if (prior === "review") return prior;
			const verified = await checkAfterVerification();
			if (verified === "review") return verified;
			if (!options.store.review(source.id)?.available)
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
		if (existing)
			return existing === "available" ? checkAfterVerification() : existing;
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
				guard,
			);
		} catch (error) {
			if (
				error instanceof DomainError &&
				error.code === "CATALOG_CONFLICT" &&
				check() === "available"
			) {
				return checkAfterVerification();
			}
			throw error;
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

	async review(
		identity: SourceIdentity,
		target: AcceptedAcquisitionTarget,
	): Promise<AcquisitionReview | null> {
		const { options } = this.context;
		const scope = await this.context.scope();
		if (!scope.ids.includes(identity.scopeId)) return null;
		const source = options.store.registerSource(identity);
		const record = options.store.review(source.id);
		if (!record) return null;
		const available = await this.context.available(record, scope.revision);
		options.sources.assertAccessRevision(scope.revision);
		const current = options.store.review(source.id);
		if (!current) return null;
		const links = options.store.associations(source.id);
		let disposition: AcquisitionReview["disposition"] = "pending";
		if (current.decision === "rejected" && current.decisionOrigin === "manual")
			disposition = "rejected";
		else if (current.decision === "confirmed") {
			const matches = this.matchesTarget(links, target);
			if (matches && available && current.available) disposition = "available";
			else if (!matches && current.decisionOrigin === "manual")
				disposition = "protected";
		}
		return {
			id: current.id,
			disposition,
			decisionKey: createHash("sha256")
				.update(
					JSON.stringify([
						current.decision,
						current.decisionOrigin,
						links
							.map(({ operationKey, episode }) =>
								JSON.stringify([
									operationKey,
									episode.id,
									episode.kind,
									episode.number,
								]),
							)
							.sort(),
					]),
				)
				.digest("hex"),
		};
	}

	private matchesTarget(
		links: ReturnType<CatalogContext["options"]["store"]["associations"]>,
		target: AcceptedAcquisitionTarget,
	) {
		return (
			links.length > 0 &&
			links.every(
				({ episode }) =>
					this.context.options.store.link(episode.workId)?.reference.id ===
						target.reference.id &&
					episode.kind === "regular" &&
					episode.number === String(target.episode),
			)
		);
	}
}
