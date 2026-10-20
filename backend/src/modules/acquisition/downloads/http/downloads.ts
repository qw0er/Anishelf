import { Type } from "typebox";
import {
	DownloadActivitySchema,
	DownloadDestinationSchema,
	DownloadRetrySchema,
	DownloadSettingsInputSchema,
	DownloadSettingsSchema,
	DownloadValidationSchema,
} from "../../../../contracts/schemas/downloads.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { DownloadsApi } from "../public.js";
export function registerDownloadRoutes(
	app: HttpInstance,
	downloads: DownloadsApi,
) {
	const path = "/api/acquisition/downloads";
	app.get(
		`${path}/settings`,
		{ schema: { response: { 200: DownloadSettingsSchema } } },
		() => downloads.settings(),
	);
	app.put(
		`${path}/settings`,
		{
			schema: {
				body: DownloadSettingsInputSchema,
				response: { 200: DownloadDestinationSchema },
			},
		},
		(request) => downloads.saveDestination(request.body),
	);
	app.post(
		`${path}/validate`,
		{
			schema: {
				body: DownloadValidationSchema,
				response: { 200: DownloadDestinationSchema },
			},
		},
		(request) => downloads.validate(request.body.revision),
	);
	app.get(
		path,
		{
			schema: {
				querystring: Type.Object({
					workKey: Type.String({ minLength: 1, maxLength: 1024 }),
					page: Type.Optional(Type.String({ pattern: "^[1-9][0-9]{0,3}$" })),
				}),
				response: { 200: DownloadActivitySchema },
			},
		},
		(request) =>
			downloads.activity(
				request.query.workKey,
				Number(request.query.page ?? 1),
			),
	);
	app.post(
		`${path}/:id/retry`,
		{
			schema: {
				params: Type.Object({
					id: Type.String({ minLength: 1, maxLength: 64 }),
				}),
				body: DownloadRetrySchema,
				response: { 200: Type.Object({ accepted: Type.Boolean() }) },
			},
		},
		(request) => {
			downloads.retry(
				request.params.id,
				request.body.revision,
				request.body.commandId,
				request.body.kind,
			);
			return { accepted: true };
		},
	);
}
