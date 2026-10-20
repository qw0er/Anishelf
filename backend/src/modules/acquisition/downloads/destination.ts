import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { DomainError } from "../../../shared/errors.js";
import type { AcquisitionTarget } from "../../anime/public.js";
import type { Subscription } from "../discovery/public.js";
import type { QbittorrentApi } from "../qbittorrent/public.js";
import { conflict, type DownloadContext } from "./context.js";
import { type DownloadDestination, DownloadError } from "./domain/model.js";
import { absoluteDownloadPath, inside, workDirectory } from "./domain/paths.js";

export class DownloadDestinationSettings {
	constructor(private readonly context: DownloadContext) {}
	async settings() {
		const saved = this.context.options.store.destination();
		const destination =
			saved &&
			saved.connectionGeneration !== this.context.options.connectionGeneration()
				? { ...saved, validated: false, visibilityVerified: false }
				: saved;
		return {
			destination,
			roots: await this.context.options.resources.roots(),
		};
	}
	saveDestination(input: {
		revision: string | null;
		scopeId: string;
		path: string;
	}) {
		return this.context.tracked(async () => {
			if (
				(this.context.options.store.destination()?.revision ?? null) !==
				input.revision
			)
				conflict();
			let path: string;
			try {
				path = absoluteDownloadPath(input.path.trim());
			} catch {
				throw new DomainError(
					"INVALID_REQUEST",
					"Enter an absolute qBittorrent destination path.",
				);
			}
			if (
				!(await this.context.options.resources.roots()).some(
					(root) => root.scopeId === input.scopeId,
				)
			)
				conflict();
			this.context.open();
			if (
				(this.context.options.store.destination()?.revision ?? null) !==
				input.revision
			)
				conflict();
			const destination: DownloadDestination = {
				revision: randomUUID(),
				scopeId: input.scopeId,
				path,
				connectionGeneration: this.context.options.connectionGeneration(),
				validated: false,
				visibilityVerified: false,
			};
			this.context.options.store.saveDestination(destination);
			this.context.options.logger.info(
				{
					event: "acquisition.destination_saved",
					revision: destination.revision,
				},
				"Download destination saved; validation and subscription confirmation are required.",
			);
			return destination;
		});
	}
	validate(revision: string) {
		return this.context.tracked(async () => {
			const destination = this.context.options.store.destination();
			if (
				!destination ||
				destination.revision !== revision ||
				destination.connectionGeneration !==
					this.context.options.connectionGeneration()
			)
				conflict();
			try {
				await this.context.options.withClient(
					destination.connectionGeneration,
					async (client) => {
						const probe = await client.probe(this.context.signal);
						await this.validateIncomplete(probe, destination);
					},
				);
				this.context.open();
				if (this.context.options.store.destination()?.revision !== revision)
					conflict();
				const result = { ...destination, validated: true };
				this.context.options.store.saveDestination(result);
				this.context.options.logger.info(
					{ event: "acquisition.destination_validated", revision },
					"Destination mapping is configured; shared visibility remains subject to completed-file verification.",
				);
				return result;
			} catch (error) {
				if (this.context.options.store.destination()?.revision === revision)
					this.context.options.store.saveDestination({
						...destination,
						validated: false,
					});
				throw new DomainError(
					"ACQUISITION_UNAVAILABLE",
					error instanceof DownloadError
						? "Enable an incomplete directory outside resource roots in qBittorrent, then validate again."
						: "Could not validate the destination. Check qBittorrent and resource configuration.",
				);
			}
		});
	}
	preview(
		key: string,
		target: AcquisitionTarget,
	): { revision: string; path: string } | null {
		const destination = this.context.options.store.destination();
		if (
			!destination?.validated ||
			destination.connectionGeneration !==
				this.context.options.connectionGeneration()
		)
			return null;
		return {
			revision: destination.revision,
			path: posix.join(
				destination.path,
				this.context.options.store.directory(key) ??
					workDirectory(key, target.work.titles[0] ?? "Anime"),
			),
		};
	}
	authorize(workKey: string, revision: string, destinationRevision: string) {
		this.context.open();
		const subscription = this.context.options.selection.subscription(workKey),
			destination = this.context.options.store.destination();
		if (
			!subscription ||
			subscription.revision !== revision ||
			!destination?.validated ||
			destination.revision !== destinationRevision ||
			destination.connectionGeneration !==
				this.context.options.connectionGeneration()
		)
			conflict();
		this.context.options.store.authorize({
			workKey,
			feedId: subscription.feedId,
			startEpisode: subscription.startEpisode,
			destinationRevision,
			connectionGeneration: destination.connectionGeneration,
		});
		this.context.options.logger.info(
			{ event: "acquisition.authorized", workKey, revision },
			"Automatic acquisition scope confirmed.",
		);
	}
	authorized(subscription: Subscription) {
		const authorization = this.context.options.store.authorization(
				subscription.workKey,
			),
			destination = this.context.options.store.destination();
		return Boolean(
			subscription.enabled &&
				destination?.validated &&
				authorization &&
				authorization.feedId === subscription.feedId &&
				authorization.startEpisode === subscription.startEpisode &&
				authorization.destinationRevision === destination.revision &&
				authorization.connectionGeneration ===
					this.context.options.connectionGeneration() &&
				destination.connectionGeneration ===
					this.context.options.connectionGeneration(),
		);
	}

	async validateIncomplete(
		probe: Awaited<ReturnType<QbittorrentApi["probe"]>>,
		destination: DownloadDestination,
	) {
		if (
			!probe.incompletePathEnabled ||
			!probe.incompletePath ||
			inside(absoluteDownloadPath(probe.incompletePath), destination.path) ||
			inside(destination.path, absoluteDownloadPath(probe.incompletePath))
		)
			throw new DownloadError("incomplete_directory_required");
		await this.context.options.resources.validate(
			destination.scopeId,
			probe.incompletePath,
		);
	}
}
