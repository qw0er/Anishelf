import { sep } from "node:path";
import type { Logger } from "pino";
import { DomainError } from "../../../../shared/errors.js";
import type { PersistentSettings } from "../../../system/public.js";
import type { ResourceRootsApi } from "../../resource-access/public.js";
import type { LibraryIndex } from "../infrastructure/index.js";
import { ResourceMutations } from "../infrastructure/mutations.js";
import type { LibrarySynchronizer } from "./library-synchronizer.js";

export interface ResourceCommand {
	id: string;
	action: "move" | "delete";
	destinationId?: string;
}
export class ResourceCommands {
	constructor(
		private readonly options: {
			index: LibraryIndex;
			roots: ResourceRootsApi;
			settings(): Readonly<PersistentSettings>;
			synchronizer: LibrarySynchronizer;
			logger: Logger;
		},
	) {}
	private async prepare(input: ResourceCommand) {
		if ((input.action === "move") !== Boolean(input.destinationId))
			throw new DomainError(
				"INVALID_REQUEST",
				"Choose a destination only for moves.",
			);
		const entry = this.options.index.getEntry(input.id);
		if (!entry.relativePath || !entry.scopeId)
			throw new DomainError(
				"RESOURCE_ACCESS_DENIED",
				"Resource roots cannot be moved or deleted.",
			);
		const root = await this.options.roots.resolve(
			this.options.settings(),
			entry.scopeId,
		);
		const resources = await this.options.roots.open(root);
		if (
			entry.kind === "file" &&
			entry.sourceVersion &&
			(await resources.inspectVideoFileWithVersion(entry.relativePath))
				.sourceVersion !== entry.sourceVersion
		)
			throw new DomainError(
				"RESOURCE_CONFLICT",
				"The file changed. Refresh Files and try again.",
			);
		const access = await ResourceMutations.create(root.path);
		let target: ResourceMutations | undefined;
		try {
			const inspected = await access.inspect(entry.relativePath);
			if ((entry.kind === "directory") !== inspected.info.isDirectory())
				throw new DomainError(
					"RESOURCE_CONFLICT",
					"The resource kind changed.",
				);
			const destination = input.destinationId
				? this.options.index.getDirectory(input.destinationId)
				: undefined;
			if (destination && !destination.scopeId)
				throw new DomainError(
					"INVALID_REQUEST",
					"Choose a directory within a resource root.",
				);
			if (
				destination?.scopeId === entry.scopeId &&
				(destination.relativePath === entry.relativePath ||
					destination.relativePath.startsWith(`${entry.relativePath}${sep}`))
			)
				throw new DomainError(
					"RESOURCE_CONFLICT",
					"A folder cannot be moved into itself.",
				);
			const targetRoot = destination
				? await this.options.roots.resolve(
						this.options.settings(),
						destination.scopeId,
					)
				: undefined;
			if (targetRoot) {
				await this.options.roots.open(targetRoot);
				target = await ResourceMutations.create(targetRoot.path);
			}
			const destinationIdentity =
				destination && target
					? await target.destination(
							destination.relativePath,
							entry.name,
							inspected.info.dev,
						)
					: undefined;
			return {
				entry,
				root,
				access,
				target,
				targetRoot,
				destination,
				destinationIdentity,
				inspected,
			};
		} catch (error) {
			await access.close();
			await target?.close();
			throw error;
		}
	}
	private translate(error: unknown): never {
		if (error instanceof DomainError) throw error;
		throw new DomainError(
			"RESOURCE_WRITE_FAILED",
			"The filesystem operation failed.",
			{ cause: error },
		);
	}
	async execute(input: ResourceCommand) {
		return this.options.synchronizer.withMutation(async (reconcile) => {
			let prepared:
				| Awaited<ReturnType<ResourceCommands["prepare"]>>
				| undefined;
			try {
				prepared = await this.prepare(input);
				this.options.logger.info(
					{
						event: "resources.command_started",
						resourceId: input.id,
						action: input.action,
						destinationId: input.destinationId,
					},
					"Resource operation started.",
				);
				const { target, destination, destinationIdentity } = prepared;
				await prepared.access.execute(
					prepared.entry.relativePath,
					prepared.inspected.treeToken,
					target && destination && destinationIdentity
						? {
								access: target,
								path: destination.relativePath,
								identity: destinationIdentity,
							}
						: undefined,
				);
				const healthy = await reconcile([
					prepared.root,
					...(prepared.targetRoot ? [prepared.targetRoot] : []),
				]);
				this.options.logger.info(
					{
						event: "resources.command_completed",
						resourceId: input.id,
						action: input.action,
						refreshRequired: !healthy,
					},
					"Resource operation completed; durable history and decisions retained.",
				);
				return { refreshRequired: !healthy };
			} catch (error) {
				this.options.logger.warn(
					{
						event: "resources.command_failed",
						resourceId: input.id,
						action: input.action,
						err: error,
					},
					"Resource operation failed; reconciling any partial filesystem changes.",
				);
				if (prepared)
					await reconcile([
						prepared.root,
						...(prepared.targetRoot ? [prepared.targetRoot] : []),
					]);
				return this.translate(error);
			} finally {
				await prepared?.access.close();
				await prepared?.target?.close();
			}
		});
	}
}
