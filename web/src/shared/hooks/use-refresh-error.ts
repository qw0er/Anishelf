import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "../components/ui/toast.js";

const failures = new Map<string, string>();

/** Keep polling failures quiet until recovery or an explicit retry. */
export function useRefreshError(
	id: string,
	error: unknown,
	updatedAt: number,
	retry?: () => void,
) {
	const { t } = useTranslation();
	useEffect(() => {
		if (!error) {
			failures.delete(id);
			toast.close(id);
			return;
		}
		const signature = error instanceof Error ? error.message : String(error);
		if (failures.get(id) === signature) return;
		failures.set(id, signature);
		if (failures.size > 100) {
			const oldest = failures.keys().next().value;
			if (oldest !== undefined) failures.delete(oldest);
		}
		console.warn("UI background refresh failed", { operation: id, updatedAt });
		toast.add({
			id,
			type: "error",
			title: t("errors.requestFailed"),
			...(retry
				? {
						actionProps: {
							children: t("actions.retry"),
							onClick: () => {
								failures.delete(id);
								retry();
							},
						},
					}
				: {}),
		});
	}, [id, error, updatedAt, t, retry]);
}
