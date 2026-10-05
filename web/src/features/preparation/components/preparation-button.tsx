import { Check, Film, RefreshCw, Settings2 } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { createPreparation, retryPreparation } from "../../../api/client.js";
import type { CompatibilityResult } from "../../../api/contracts.js";
import { Button, buttonStyles } from "../../../components/ui/button.js";
import { DropdownMenuItem } from "../../../components/ui/dropdown-menu.js";
import { Spinner } from "../../../components/ui/spinner.js";
import { toast } from "../../../components/ui/toast.js";
import { Tooltip } from "../../../components/ui/tooltip.js";
import { usePreparationContext } from "../context.js";
import { negotiatePreparation } from "../negotiation.js";
import { usePreparationAction } from "../use-preparations.js";

export function PreparationButton({
	fileId,
	loading,
	result,
	error,
	onRecheck,
	menuItem = false,
	tasks,
}: {
	fileId: string;
	loading: boolean;
	result: CompatibilityResult | null;
	error: unknown;
	onRecheck(): void;
	menuItem?: boolean;
	tasks?: import("../../../api/contracts.js").PreparationTaskResponse[];
}) {
	const { t } = useTranslation();
	const preparation = usePreparationContext();
	const action = usePreparationAction();
	function control(label: string, element: ReactElement, disabled = false) {
		return menuItem ? (
			<DropdownMenuItem
				render={element}
				nativeButton={element.type !== Link}
				disabled={disabled}
			/>
		) : (
			<Tooltip content={label}>{element}</Tooltip>
		);
	}
	if (loading)
		return menuItem ? null : (
			<span
				className="flex size-9 items-center justify-center text-muted-foreground"
				role="status"
				aria-label={t("compatibility.checking")}
			>
				<Spinner />
			</span>
		);
	if (error || !result || result.direct.status === "unknown")
		return control(
			t("compatibility.recheck"),
			<Button
				variant="ghost"
				className={menuItem ? "w-full justify-start" : "size-9 p-0"}
				onClick={onRecheck}
				aria-label={t("compatibility.recheck")}
			>
				<RefreshCw className="size-4" aria-hidden="true" />
				{menuItem && t("compatibility.recheck")}
			</Button>,
		);
	if (result.direct.status === "supported") return null;
	if (!preparation.catalog && !preparation.catalogError)
		return menuItem ? null : (
			<span
				className="flex size-9 items-center justify-center text-muted-foreground"
				role="status"
				aria-label={t("preparation.loadingProfiles")}
			>
				<Spinner />
			</span>
		);
	const profile = preparation.catalog?.selectionAvailable
		? preparation.catalog.selectedProfileId
		: null;
	const task = (tasks ?? preparation.tasks).find(
		(task) =>
			task.fileId === fileId &&
			task.sourceVersion === result.sourceVersion &&
			task.profileId === profile,
	);
	const pending = task?.status === "queued" || task?.status === "processing";
	if (!profile)
		return control(
			t("preparation.configure"),
			<Link
				className={buttonStyles(
					"ghost",
					menuItem ? "w-full justify-start" : "size-9 p-0",
				)}
				to="/settings"
				aria-label={t("preparation.configure")}
			>
				<Settings2 className="size-4" aria-hidden="true" />
				{menuItem && t("preparation.configure")}
			</Link>,
		);
	if (menuItem && (pending || task?.status === "ready")) return null;
	const label = t(
		menuItem
			? "preparation.pretranscode"
			: action.busy
				? "preparation.checking"
				: pending
					? `preparation.status.${task.status}`
					: task?.status === "ready"
						? "preparation.status.ready"
						: "preparation.pretranscode",
	);
	return control(
		label,
		<Button
			variant="ghost"
			className={
				menuItem
					? "w-full justify-start"
					: "size-9 p-0 aria-disabled:opacity-50"
			}
			aria-label={label}
			focusableWhenDisabled
			disabled={action.busy || pending || task?.status === "ready"}
			onClick={() =>
				void action.run(async (signal) => {
					const body = await negotiatePreparation(
						fileId,
						profile,
						signal,
						result.sourceVersion,
					);
					if (
						task &&
						(task.status === "failed" || task.status === "cancelled")
					) {
						preparation.remember(
							await retryPreparation(task.id, body, { signal }),
						);
						return;
					}
					const response = await createPreparation(fileId, body, { signal });
					if (signal.aborted) return;
					if (response.kind === "task") preparation.remember(response.task);
					else if (response.kind === "direct") onRecheck();
					else
						toast.add({
							type: "warning",
							title: t(`compatibility.reasons.${response.reason}`, {
								defaultValue: t("preparation.blocked"),
							}),
						});
				})
			}
		>
			{action.busy || pending ? (
				<Spinner />
			) : task?.status === "ready" ? (
				<Check className="size-4" aria-hidden="true" />
			) : (
				<Film className="size-4" aria-hidden="true" />
			)}
			{menuItem && label}
		</Button>,
		action.busy || pending || task?.status === "ready",
	);
}
