import {
	CircleAlert,
	CircleCheck,
	CircleHelp,
	CircleX,
	FileCheck2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/button.js";
import { Spinner } from "../../../components/ui/spinner.js";
import { Tooltip } from "../../../components/ui/tooltip.js";
import { getErrorTranslationKey } from "../../../lib/error-translation.js";
import type { DirectoryCompatibilityState } from "../hooks/use-directory-compatibility.js";

export function CompatibilityStatus({
	loading,
	result,
	error,
	prepared = false,
}: DirectoryCompatibilityState & { prepared?: boolean }) {
	const { t } = useTranslation();
	const state = loading
		? "checking"
		: prepared
			? "prepared"
			: error
				? "failed"
				: (result?.direct.status ?? "unknown");
	const label = t(`compatibility.${state}`);
	const reason = loading
		? null
		: error
			? t(getErrorTranslationKey(error) ?? "errors.requestFailed")
			: result
				? t(`compatibility.reasons.${result.direct.reason}`, {
						defaultValue: t("compatibility.reasonUnknown"),
					})
				: t("compatibility.reasonUnknown");
	const Icon =
		state === "prepared"
			? FileCheck2
			: state === "supported"
				? CircleCheck
				: state === "unsupported"
					? CircleX
					: state === "failed"
						? CircleAlert
						: CircleHelp;
	return (
		<Tooltip
			content={
				<div className="space-y-1">
					<p>{label}</p>
					{prepared && !loading && (
						<p>
							{t(
								`compatibility.${error ? "failed" : (result?.direct.status ?? "unknown")}`,
							)}
						</p>
					)}
					{reason && <p>{reason}</p>}
				</div>
			}
		>
			<Button
				variant="ghost"
				className="size-9 shrink-0 p-0 text-muted-foreground"
				aria-label={label}
				aria-busy={loading}
			>
				{loading ? <Spinner /> : <Icon className="size-4" aria-hidden="true" />}
			</Button>
		</Tooltip>
	);
}
