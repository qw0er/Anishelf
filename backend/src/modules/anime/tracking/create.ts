import type { Logger } from "pino";
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
	TrackingStore,
	TrackingUpdateProvider,
} from "./ports.js";

export interface TrackingAccountAssemblyOptions {
	descriptor: TrackingProviderDescriptor;
	store: TrackingStore;
	credentials: TrackingCredentials;
	provider: TrackingAccountProvider;
	now?: () => number;
	logger?: Logger;
}
export function createTrackingAccounts(
	options: TrackingAccountAssemblyOptions,
): TrackingAccountApplication {
	const logger = options.logger?.child({
		module: "tracking",
		provider: options.descriptor.key,
	});
	let authorizations: TrackingAuthorizations;
	const connection = new TrackingConnectionState({
		authorization: { provider: options.descriptor },
		store: options.store,
		credentials: options.credentials,
		...(options.now ? { now: options.now } : {}),
		...(logger ? { logger } : {}),
		onChange: () => authorizations.clear(),
	});
	authorizations = new TrackingAuthorizations(
		connection,
		options.provider,
		options.now ?? Date.now,
		logger,
	);
	const checks = new TrackingConnectionCheck(
		connection,
		options.credentials,
		options.provider,
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
	logger?: Logger;
}
export async function createTrackingModule(
	options: TrackingModuleOptions,
): Promise<TrackingModule> {
	const logger = options.logger?.child({ provider: options.descriptor.key });
	const credentials = new TrackingCredentialFiles(options.dataDir);
	const accounts = createTrackingAccounts({
		descriptor: options.descriptor,
		store: options.store,
		credentials,
		provider: options.accountProvider,
		...(logger ? { logger } : {}),
	});
	await credentials.initialize(options.store.get()?.credentialId ?? null);
	await accounts.initialize();
	const lists = new TrackingListReader({
		access: accounts,
		store: options.listStore,
		provider: options.listProvider,
		...(logger ? { logger } : {}),
	});
	const updates = new TrackingUpdates({
		access: accounts,
		store: options.operationStore,
		provider: options.updateProvider,
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
