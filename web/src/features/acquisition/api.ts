import { type RequestOptions, request } from "../../shared/api/client.js";
import type {
	QbittorrentConnectionProbe,
	QbittorrentConnectionSettings,
	QbittorrentConnectionUpdate,
} from "../../shared/api/contracts.js";

const url = "/api/acquisition/qbittorrent";
export const getQbittorrentConnection = (
	options?: RequestOptions,
): Promise<QbittorrentConnectionSettings> => request(url, "GET", options);
export const saveQbittorrentConnection = (
	input: QbittorrentConnectionUpdate,
): Promise<QbittorrentConnectionSettings> => request(url, "PUT", {}, input);
export const clearQbittorrentConnection = (
	generation: string,
): Promise<QbittorrentConnectionSettings> =>
	request(url, "DELETE", {}, { generation });
export const checkQbittorrentConnection = (
	generation: string,
): Promise<QbittorrentConnectionProbe> =>
	request(`${url}/check`, "POST", {}, { generation });

export const getQbittorrentCredentials = (
	generation: string,
): Promise<{ username: string; password: string }> =>
	request(`${url}/credentials`, "POST", {}, { generation });
