import type { Logger } from "pino";
import { AniListAccountClient } from "../anilist/infrastructure/account-client.js";
import { AniListListsClient } from "../anilist/infrastructure/lists-client.js";
import { aniListAuthorization } from "../anilist/policy.js";
import type { AniListClient } from "../anilist/public.js";
import { TrackingAccountApplication } from "../tracking/application/account.js";
import { TrackingAuthorizations } from "../tracking/application/authorizations.js";
import { TrackingConnectionState } from "../tracking/application/connection.js";
import { TrackingConnectionCheck } from "../tracking/application/connection-check.js";
import { TrackingDiagnostics } from "../tracking/application/diagnostics.js";
import { TrackingListReader } from "../tracking/application/list-cache.js";
import { TrackingModule } from "../tracking/application/tracking.js";
import { AniListAccountProvider } from "../tracking/infrastructure/account-provider.js";
import { TrackingCredentialFiles } from "../tracking/infrastructure/credentials.js";
import { AniListListProvider } from "../tracking/infrastructure/list-provider.js";
import type {
	TrackingAccountProvider,
	TrackingCredentials,
	TrackingListStore,
	TrackingStore,
} from "../tracking/ports.js";

export interface TrackingAccountAssemblyOptions {
	store: TrackingStore;
	credentials: TrackingCredentials;
	provider: TrackingAccountProvider;
	now?: () => number;
	logger?: Logger;
}
export function createTrackingAccounts(
	options: TrackingAccountAssemblyOptions,
): TrackingAccountApplication {
	const logger = options.logger?.child({ module: "tracking" });
	let authorizations: TrackingAuthorizations;
	const connection = new TrackingConnectionState({
		authorization: aniListAuthorization,
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
	client: AniListClient;
	logger?: Logger;
}
export async function createTrackingModule(
	options: TrackingModuleOptions,
): Promise<TrackingModule> {
	const credentials = new TrackingCredentialFiles(options.dataDir);
	await credentials.initialize(options.store.get()?.credentialId ?? null);
	const accounts = createTrackingAccounts({
		store: options.store,
		credentials,
		provider: new AniListAccountProvider(
			new AniListAccountClient(options.client),
		),
		...(options.logger ? { logger: options.logger } : {}),
	});
	await accounts.initialize();
	const lists = new TrackingListReader({
		access: accounts,
		store: options.listStore,
		provider: new AniListListProvider(new AniListListsClient(options.client)),
		...(options.logger ? { logger: options.logger } : {}),
	});
	return new TrackingModule(accounts, lists);
}
