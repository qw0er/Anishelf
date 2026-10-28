import { Type } from "typebox";
import {
	QbittorrentConnectionCommandSchema,
	QbittorrentConnectionProbeSchema,
	QbittorrentConnectionSettingsSchema,
	QbittorrentConnectionUpdateSchema,
} from "../../../../contracts/schemas/acquisition.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { QbittorrentConnectionApi } from "./public.js";

export function registerConnectionRoutes(
	app: HttpInstance,
	connection: QbittorrentConnectionApi,
) {
	const url = "/api/acquisition/qbittorrent";
	app.post(
		`${url}/credentials`,
		{
			schema: {
				body: QbittorrentConnectionCommandSchema,
				response: {
					200: Type.Object({
						username: Type.String(),
						password: Type.String(),
					}),
				},
			},
		},
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			return connection.credentials(request.body.generation);
		},
	);
	app.get(
		url,
		{ schema: { response: { 200: QbittorrentConnectionSettingsSchema } } },
		async () => connection.settings(),
	);
	app.put(
		url,
		{
			bodyLimit: 32 * 1024,
			schema: {
				body: QbittorrentConnectionUpdateSchema,
				response: { 200: QbittorrentConnectionSettingsSchema },
			},
		},
		async (request) => connection.save(request.body),
	);
	app.delete(
		url,
		{
			schema: {
				body: QbittorrentConnectionCommandSchema,
				response: { 200: QbittorrentConnectionSettingsSchema },
			},
		},
		async (request) => connection.clear(request.body.generation),
	);
	app.post(
		`${url}/check`,
		{
			schema: {
				body: QbittorrentConnectionCommandSchema,
				response: { 200: QbittorrentConnectionProbeSchema },
			},
		},
		async (request) => connection.probe(request.body.generation),
	);
}
