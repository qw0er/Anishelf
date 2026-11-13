import i18n from "../../shared/i18n.js";

export function watchingReason(reason: string, compact = false): string {
	return i18n.t(
		`acquisition.watching.${compact ? "shortReasons" : "reasons"}.${reason}`,
		{
			defaultValue: i18n.t(
				compact
					? "acquisition.activity.needsAttention"
					: "acquisition.watching.unknownReason",
			),
		},
	);
}
