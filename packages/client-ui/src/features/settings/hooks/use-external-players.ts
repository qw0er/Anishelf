import { useEffect, useState } from "react";
import { getClientRuntime } from "../../../shared/api/connection.js";
import type { ExternalPlayerCatalog } from "../../../shared/platform.js";

export function useExternalPlayers() {
	const { platform } = getClientRuntime();
	const host = platform.externalPlayers;
	const [catalog, setCatalog] = useState<ExternalPlayerCatalog>(() =>
		host.list(),
	);
	useEffect(() => host.subscribe(() => setCatalog(host.list())), [host]);
	return {
		mode: host.mode,
		presets: catalog.presets,
		custom: catalog.custom,
		error: catalog.error,
		validate: host.validate,
		add: host.add,
		remove: host.remove,
		describe: host.describe,
		link: host.link,
		launch: host.launch,
	};
}
