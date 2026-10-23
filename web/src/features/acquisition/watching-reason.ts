import i18n from "../../shared/i18n.js";

export function watchingReason(reason: string): string {
	return i18n.t(`acquisition.watching.reasons.${reason}`, {
		defaultValue: i18n.t("acquisition.watching.unknownReason"),
	});
}
