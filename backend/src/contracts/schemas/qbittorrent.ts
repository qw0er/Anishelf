import { Type } from "typebox";

/** Read-only navigation and availability; settings are managed by Configuration. */
export const QbittorrentWebUiSchema = Type.Object(
	{
		url: Type.String(),
		proxyConfigured: Type.Boolean(),
	},
	{ additionalProperties: false },
);
