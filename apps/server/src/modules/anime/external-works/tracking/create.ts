import type { Logger } from "pino";
import { externalIdParts } from "../../../../shared/external-reference.js";
import { TrackingAccountApplication } from "./application/account.js";
import { TrackingAuthorizations } from "./application/authorizations.js";
import { TrackingConnectionState } from "./application/connection.js";
import { TrackingConnectionCheck } from "./application/connection-check.js";
import { TrackingDiagnostics } from "./application/diagnostics.js";
import { TrackingListReader } from "./application/list-cache.js";
import { TrackingModule } from "./application/tracking.js";
import { TrackingUpdates } from "./application/updates.js";
import type { TrackingProviderDescriptor } from "./domain/model.js";
import { TrackingCredentialFiles } from "./infrastructure/credentials.js";
import type {
	TrackingAccountProvider,
	TrackingCredentials,
	TrackingListProvider,
	TrackingListStore,
	TrackingOperationStore,
	TrackingProvider,
	TrackingStore,
	TrackingUpdateProvider,
} from "./ports.js";

export interface TrackingAccountAssemblyOptions {
	descriptor: TrackingProviderDescriptor;
	store: TrackingStore;
	credentials: TrackingCredentials;
	provider: TrackingAccountProvider;
	additionalProviders?: readonly TrackingProvider[];
	now?: () => number;
	logger?: Logger;
}
export function createTrackingAccounts(
	options: TrackingAccountAssemblyOptions,
): TrackingAccountApplication {
	const logger = options.logger?.child({
		module: "tracking",
	});
	const providerFor = (key: string) =>
		key === options.descriptor.key
			? options.provider
			: options.additionalProviders?.find(
					({ descriptor }) => descriptor.key === key,
				)?.accountProvider;
	let authorizations: TrackingAuthorizations;
	const connection = new TrackingConnectionState({
		authorization: { provider: options.descriptor },
		...(options.additionalProviders
			? {
					providers: [
						options.descriptor,
						...options.additionalProviders.map(({ descriptor }) => descriptor),
					],
				}
			: {}),
		store: options.store,
		credentials: options.credentials,
		...(options.now ? { now: options.now } : {}),
		...(logger ? { logger } : {}),
		onChange: () => authorizations.clear(),
	});
	authorizations = new TrackingAuthorizations(
		connection,
		providerFor,
		options.now ?? Date.now,
		logger,
	);
	const checks = new TrackingConnectionCheck(
		connection,
		options.credentials,
		providerFor,
		logger,
	);
	const diagnostics = new TrackingDiagnostics(connection, logger);
	return new TrackingAccountApplication({
		connection,
		authorizations,
		checks,
		diagnostics,
		...(logger ? { logger } : {}),
	});
}
export interface TrackingModuleOptions {
	dataDir: string;
	store: TrackingStore;
	listStore: TrackingListStore;
	operationStore: TrackingOperationStore;
	descriptor: TrackingProviderDescriptor;
	accountProvider: TrackingAccountProvider;
	listProvider: TrackingListProvider;
	updateProvider: TrackingUpdateProvider;
	additionalProviders?: readonly TrackingProvider[];
	logger?: Logger;
}
export async function createTrackingModule(
	options: TrackingModuleOptions,
): Promise<TrackingModule> {
	const logger = options.logger?.child({ module: "tracking" });
	const credentials = new TrackingCredentialFiles(options.dataDir);
	const accounts = createTrackingAccounts({
		descriptor: options.descriptor,
		store: options.store,
		credentials,
		provider: options.accountProvider,
		...(options.additionalProviders
			? { additionalProviders: options.additionalProviders }
			: {}),
		...(logger ? { logger } : {}),
	});
	await credentials.initialize(options.store.get()?.credentialId ?? null);
	await accounts.initialize();
	const sourceFor = (accountId: string) =>
		options.additionalProviders?.find(
			({ descriptor }) =>
				descriptor.key === externalIdParts(accountId).provider,
		);
	const lists = new TrackingListReader({
		access: accounts,
		store: options.listStore,
		provider: {
			read: (...args) =>
				(
					sourceFor(args[0].accountId)?.listProvider ?? options.listProvider
				).read(...args),
		},
		...(logger ? { logger } : {}),
	});
	const updates = new TrackingUpdates({
		access: accounts,
		store: options.operationStore,
		provider: {
			get: (...args) =>
				(
					sourceFor(args[0].accountId)?.updateProvider ?? options.updateProvider
				).get(...args),
			inspectProgress: async (...args) =>
				(
					sourceFor(args[0].accountId)?.updateProvider ?? options.updateProvider
				).inspectProgress?.(...args),
			save: (...args) =>
				(
					sourceFor(args[0].accountId)?.updateProvider ?? options.updateProvider
				).save(...args),
		},
		confirmed: (accountId, mediaId, remote) =>
			lists.confirmed(accountId, mediaId, remote),
		...(logger ? { logger } : {}),
	});
	logger?.debug(
		{ event: "tracking.services_configured" },
		"Tracking account, list and update services configured.",
	);
	return new TrackingModule(accounts, lists, updates);
}
