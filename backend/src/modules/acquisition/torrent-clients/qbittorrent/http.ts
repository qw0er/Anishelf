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
	/** Availability is a filesystem fact, so it is refreshed with every view. */
	const settingsView = async () => ({
		...connection.settings(),
		bundledAvailable: await connection.bundledAvailable(),
	});
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
		async () => settingsView(),
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
		async (request) => {
			await connection.save(request.body);
			return settingsView();
		},
	);
	app.delete(
		url,
		{
			schema: {
				body: QbittorrentConnectionCommandSchema,
				response: { 200: QbittorrentConnectionSettingsSchema },
			},
		},
		async (request) => {
			await connection.clear(request.body.generation);
			return settingsView();
		},
	);
	app.post(
		`${url}/bundled`,
		{
			schema: {
				body: QbittorrentConnectionCommandSchema,
				response: { 200: QbittorrentConnectionSettingsSchema },
			},
		},
		async (request) => {
			await connection.activateBundled(request.body.generation);
			return settingsView();
		},
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
