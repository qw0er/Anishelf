import { Type } from "typebox";
import { MetadataReferenceSchema } from "../../../../contracts/schemas/metadata.js";
import type { HttpInstance } from "../../../../transport/instance.js";
import type { WorkReference } from "../public.js";

/** Authenticated management command; source mappings never enter the content API. */
export function registerMetadataAssociationRoutes(
	app: HttpInstance,
	management: {
		associate(
			target: WorkReference,
			other: WorkReference,
			confirmation: { sameEpisodeNumbering: true },
		): WorkReference;
	},
) {
	app.post(
		"/api/metadata/associations",
		{
			schema: {
				body: Type.Object(
					{
						target: MetadataReferenceSchema,
						other: MetadataReferenceSchema,
						sameEpisodeNumbering: Type.Literal(true),
					},
					{ additionalProperties: false },
				),
				response: { 200: MetadataReferenceSchema },
			},
		},
		async (request) =>
			management.associate(request.body.target, request.body.other, {
				sameEpisodeNumbering: request.body.sameEpisodeNumbering,
			}),
	);
}
