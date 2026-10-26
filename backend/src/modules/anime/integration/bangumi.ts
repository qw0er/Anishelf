import type { Logger } from "pino";
import { BangumiClient } from "../bangumi/public.js";
import { BangumiProvider } from "../metadata/infrastructure/bangumi.js";
export function createBangumiMetadata(logger: Logger) {
	const client = new BangumiClient({ logger });
	return { provider: new BangumiProvider(client), close: () => client.close() };
}
