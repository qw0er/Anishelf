import { Type } from "typebox";

/** Safe summary of an optional custom-profile file that could not be loaded. */
export const ProfileCatalogIssueSchema = Type.Object(
	{
		file: Type.String({ minLength: 1, maxLength: 256 }),
		detail: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
	},
	{ additionalProperties: false },
);
