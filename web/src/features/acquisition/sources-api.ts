import { type RequestOptions, request } from "../../shared/api/client.js";
import type {
	SourceConnectorSettings,
	SourceConnectorUpdate,
	SourceProbe,
	SourceProviders,
	SourceTestInput,
	SourceTestResult,
} from "../../shared/api/contracts.js";

const path = "/api/acquisition/sources";
export const sourceSettingsKey = [
	"acquisition",
	"sources",
	"connector",
] as const;
export const getSourceConnector = (
	options?: RequestOptions,
): Promise<SourceConnectorSettings> =>
	request(`${path}/connector`, "GET", options);
export const saveSourceConnector = (
	input: SourceConnectorUpdate,
): Promise<SourceConnectorSettings> =>
	request(`${path}/connector`, "PUT", {}, input);
export const clearSourceConnector = (
	generation: string,
): Promise<SourceConnectorSettings> =>
	request(`${path}/connector`, "DELETE", {}, { generation });
export const activateBundledSourceConnector = (
	generation: string,
): Promise<SourceConnectorSettings> =>
	request(`${path}/connector/bundled`, "POST", {}, { generation });
export const getSourceProviders = (
	generation: string,
): Promise<SourceProviders> =>
	request(`${path}/connector/providers`, "POST", {}, { generation });
export const probeSourceProvider = (
	generation: string,
	providerId: string,
): Promise<SourceProbe> =>
	request(`${path}/connector/probe`, "POST", {}, { generation, providerId });
export const testSource = (input: SourceTestInput): Promise<SourceTestResult> =>
	request(`${path}/test`, "POST", {}, input);
