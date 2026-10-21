import { randomUUID } from "node:crypto";
import { DomainError } from "../../../shared/errors.js";
import { conflict } from "../downloads/application/context.js";
import type { AcquisitionContext } from "./context.js";
import type { DownloadDestinationSettings } from "./destination.js";

export class DownloadCommands {
	constructor(
		private readonly context: AcquisitionContext,
		private readonly destination: DownloadDestinationSettings,
	) {}
	retry(
		id: string,
		revision: string,
		commandId: string,
		kind: "acquisition" | "import",
	) {
		this.context.open();
		let item = this.context.options.store.intent(id);
		if (!item) conflict();
		const recoveringConnection =
			item.error === "downloader_configuration_changed";
		if (item.lastCommand?.id === commandId) {
			if (item.lastCommand.kind !== kind) conflict();
			return;
		}
		if (!item.source && kind === "acquisition" && !recoveringConnection)
			throw new DomainError(
				"INVALID_REQUEST",
				"Release evidence expired. Manage this download in qBittorrent WebUI.",
			);
		if (item.revision !== revision || !commandId || commandId.length > 64)
			conflict();
		if (
			kind === "import" &&
			(item.state !== "bound" || !["failed", "review"].includes(item.ingestion))
		)
			conflict();
		if (kind === "acquisition") {
			if (
				!["missing", "blocked", "unknown"].includes(item.state) &&
				!(item.state === "pending" && item.error)
			)
				conflict();
			const subscription = this.context.options.selection.subscription(
				item.workKey,
			);
			if (
				!subscription ||
				!this.destination.authorized(subscription) ||
				item.state === "available" ||
				item.state === "bound"
			)
				conflict();
			const choice = this.context.options.selection
				.candidates(item.workKey)
				.find(
					(candidate) =>
						candidate.episode === item?.episode &&
						candidate.status === "selected",
				);
			const entry = choice
				? this.context.options.selection.release(
						subscription.feedId,
						choice.entryId,
					)
				: null;
			const destination = this.context.options.store.destination();
			if (recoveringConnection && destination) item = { ...item, destination };
			if (
				choice &&
				entry?.downloadUrl &&
				destination &&
				(item.state === "missing" ||
					item.state === "pending" ||
					item.error === "selection_changed" ||
					item.hash.startsWith("unresolved:"))
			) {
				item = {
					...item,
					candidateId: choice.id,
					title: choice.title.slice(0, 1024),
					source: entry.downloadUrl,
					hash:
						entry.downloadUrl === item.source
							? item.hash
							: `unresolved:${randomUUID()}`,
					expectedHash: entry.hash,
					destination,
					subscriptionRevision: subscription.revision,
				};
			}
		}
		this.context.options.logger.info(
			{
				event: "acquisition.retry_requested",
				intentId: item.id,
				commandId,
				kind,
			},
			"Acquisition recovery command accepted.",
		);
		// Unknown submissions always reconcile before a retry can add anything.
		this.context.save({
			...item,
			state:
				kind === "import"
					? "bound"
					: recoveringConnection
						? "unknown"
						: "pending",
			ingestion: kind === "import" ? "pending" : "not-ready",
			error: null,
			nextAttemptAt: 0,
			lastCommand: { id: commandId, kind },
		});
	}
}
