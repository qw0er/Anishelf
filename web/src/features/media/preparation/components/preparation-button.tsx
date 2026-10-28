import { Check, Film, Settings2 } from "lucide-react";
import { type ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
	Button,
	buttonStyles,
} from "../../../../shared/components/ui/button.js";
import { DropdownMenuItem } from "../../../../shared/components/ui/dropdown-menu.js";
import { Spinner } from "../../../../shared/components/ui/spinner.js";
import { Tooltip } from "../../../../shared/components/ui/tooltip.js";
import type { PreparationSource } from "../audio-tracks.js";
import { usePreparationCommand } from "../use-preparation-command.js";
import { AudioTrackDialog } from "./audio-track-dialog.js";

export function PreparationButton({
	fileId,
	source,
	onRecheck,
	menuItem = false,
	tasks,
	audioStreamIndices,
	showLabel = false,
	onPrepared,
}: {
	fileId: string;
	source: PreparationSource | null;
	onRecheck(): void;
	menuItem?: boolean;
	audioStreamIndices?: number[];
	showLabel?: boolean;
	onPrepared?(
		task: import("../../../../shared/api/contracts.js").PreparationTaskResponse,
	): void;
	tasks?: import("../../../../shared/api/contracts.js").PreparationTaskResponse[];
}) {
	const { t } = useTranslation();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [dialogSelection, setDialogSelection] = useState<number[] | undefined>(
		undefined,
	);
	const tracks = source?.audioTracks ?? [];
	const chooseTracks = tracks.length > 1 && audioStreamIndices === undefined;
	const selection = chooseTracks ? dialogSelection : audioStreamIndices;
	function control(label: string, element: ReactElement, disabled = false) {
		return menuItem ? (
			<DropdownMenuItem
				render={element}
				nativeButton={element.type !== Link}
				closeOnClick={false}
				disabled={disabled}
			/>
		) : (
			<Tooltip content={label}>{element}</Tooltip>
		);
	}
	const { profileLoading, profile, task, pending, busy, start } =
		usePreparationCommand({
			fileId,
			source,
			...(tasks ? { tasks } : {}),
			...(selection !== undefined ? { audioStreamIndices: selection } : {}),
			...(onPrepared ? { onPrepared } : {}),
			onRecheck,
			onComplete: () => setDialogOpen(false),
		});

	if (!profile && !profileLoading)
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
	const label = t(
		menuItem
			? "preparation.pretranscode"
			: busy
				? "preparation.checking"
				: pending
					? `preparation.status.${task?.status}`
					: task?.status === "ready"
						? "preparation.status.ready"
						: "preparation.pretranscode",
	);

	const button = control(
		label,
		<Button
			variant={showLabel && !menuItem ? "outline" : "ghost"}
			className={
				menuItem
					? "w-full justify-start"
					: showLabel
						? undefined
						: "size-9 p-0 aria-disabled:opacity-50"
			}
			aria-label={label}
			focusableWhenDisabled
			disabled={
				profileLoading ||
				busy ||
				(!chooseTracks && (pending || task?.status === "ready"))
			}
			onClick={() => {
				if (chooseTracks) {
					setDialogSelection(undefined);
					setDialogOpen(true);
				} else start();
			}}
		>
			{profileLoading || busy || pending ? (
				<Spinner />
			) : task?.status === "ready" ? (
				<Check className="size-4" aria-hidden="true" />
			) : (
				<Film className="size-4" aria-hidden="true" />
			)}
			{(menuItem || showLabel) && label}
		</Button>,
		profileLoading ||
			busy ||
			(!chooseTracks && (pending || task?.status === "ready")),
	);

	return (
		<>
			{button}
			{chooseTracks && (
				<AudioTrackDialog
					dialogOpen={dialogOpen}
					onOpenChange={setDialogOpen}
					tracks={tracks}
					selection={selection}
					onSelectionChange={setDialogSelection}
					busy={busy}
					pending={pending}
					ready={task?.status === "ready"}
					status={task?.status}
					onStart={start}
				/>
			)}
		</>
	);
}
