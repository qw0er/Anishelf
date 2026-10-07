import { Check, Film, Settings2 } from "lucide-react";
import { type ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { createPreparation, retryPreparation } from "../../../api/client.js";
import type { CompatibilityResult } from "../../../api/contracts.js";
import { Button, buttonStyles } from "../../../components/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../../../components/ui/dialog.js";
import { DropdownMenuItem } from "../../../components/ui/dropdown-menu.js";
import { Spinner } from "../../../components/ui/spinner.js";
import { toast } from "../../../components/ui/toast.js";
import { Tooltip } from "../../../components/ui/tooltip.js";
import { audioTrackLabel, matchesAudioSelection } from "../audio-tracks.js";
import { usePreparationContext } from "../context.js";
import { negotiatePreparation } from "../negotiation.js";
import { usePreparationAction } from "../use-preparations.js";

export function PreparationButton({
	fileId,
	result,
	onRecheck,
	menuItem = false,
	tasks,
	audioStreamIndices,
	showLabel = false,
	onPrepared,
}: {
	fileId: string;
	loading: boolean;
	result: CompatibilityResult | null;
	error: unknown;
	onRecheck(): void;
	menuItem?: boolean;
	audioStreamIndices?: number[];
	showLabel?: boolean;
	onPrepared?(
		task: import("../../../api/contracts.js").PreparationTaskResponse,
	): void;
	tasks?: import("../../../api/contracts.js").PreparationTaskResponse[];
}) {
	const { t, i18n } = useTranslation();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [dialogSelection, setDialogSelection] = useState<number[] | undefined>(
		undefined,
	);
	const tracks = result?.audioTracks ?? [];
	const chooseTracks = tracks.length > 1 && audioStreamIndices === undefined;
	const selection = chooseTracks ? dialogSelection : audioStreamIndices;
	const allTracks = tracks.map(({ stream }) => stream.index);
	const preparation = usePreparationContext();
	const action = usePreparationAction();
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
	const profileLoading = !preparation.catalog && !preparation.catalogError;
	const sourceVersion = result?.sourceVersion;
	const profile = preparation.catalog?.selectionAvailable
		? preparation.catalog.selectedProfileId
		: null;
	const task = (tasks ?? preparation.tasks).find(
		(task) =>
			task.fileId === fileId &&
			sourceVersion !== undefined &&
			task.sourceVersion === sourceVersion &&
			task.profileId === profile &&
			(preparation.catalog?.preparationMode !== "compatible" ||
				task.mode === "transcode") &&
			matchesAudioSelection(task, selection, allTracks),
	);
	const pending =
		task?.status === "queued" ||
		task?.status === "processing" ||
		task?.status === "cancelling";
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
			: action.busy
				? "preparation.checking"
				: pending
					? `preparation.status.${task.status}`
					: task?.status === "ready"
						? "preparation.status.ready"
						: "preparation.pretranscode",
	);
	function start() {
		if (!profile || pending || task?.status === "ready") return;
		void action.run(async (signal) => {
			const body = await negotiatePreparation(
				fileId,
				profile,
				signal,
				sourceVersion,
				selection,
			);
			if (task && (task.status === "failed" || task.status === "cancelled")) {
				const retried = await retryPreparation(task.id, body, { signal });
				if (signal.aborted) return;
				onPrepared?.(retried);
				setDialogOpen(false);
				return;
			}
			const response = await createPreparation(fileId, body, { signal });
			if (signal.aborted) return;
			if (response.kind === "task") {
				onPrepared?.(response.task);
				setDialogOpen(false);
			} else if (response.kind === "direct") onRecheck();
			else
				toast.add({
					type: "warning",
					title: t(`compatibility.reasons.${response.reason}`, {
						defaultValue: t("preparation.blocked"),
					}),
				});
		});
	}
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
				action.busy ||
				(!chooseTracks && (pending || task?.status === "ready"))
			}
			onClick={() => {
				if (chooseTracks) {
					setDialogSelection(undefined);
					setDialogOpen(true);
				} else start();
			}}
		>
			{profileLoading || action.busy || pending ? (
				<Spinner />
			) : task?.status === "ready" ? (
				<Check className="size-4" aria-hidden="true" />
			) : (
				<Film className="size-4" aria-hidden="true" />
			)}
			{(menuItem || showLabel) && label}
		</Button>,
		profileLoading ||
			action.busy ||
			(!chooseTracks && (pending || task?.status === "ready")),
	);

	return (
		<>
			{button}
			{chooseTracks && (
				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
						<DialogHeader>
							<DialogTitle>{t("audioTracks.prepareTitle")}</DialogTitle>
						</DialogHeader>
						<p className="text-sm text-muted-foreground">
							{t("audioTracks.prepareDescription")}
						</p>
						<div className="action-row">
							<Button
								variant="outline"
								disabled={action.busy}
								onClick={() => setDialogSelection(undefined)}
							>
								{t("audioTracks.all")}
							</Button>
							<Button
								variant="outline"
								disabled={action.busy}
								onClick={() => setDialogSelection([])}
							>
								{t("audioTracks.none")}
							</Button>
						</div>
						<fieldset className="space-y-3">
							<legend className="sr-only">{t("audioTracks.label")}</legend>
							{tracks.map(({ stream, compatibility }, position) => (
								<label
									key={stream.index}
									className="flex items-start gap-3 text-sm"
								>
									<input
										type="checkbox"
										disabled={action.busy}
										className="mt-1 size-4 accent-primary"
										checked={(selection ?? allTracks).includes(stream.index)}
										onChange={(event) => {
											const checked = event.target.checked;
											setDialogSelection(
												allTracks.filter((index) =>
													index === stream.index
														? checked
														: (selection ?? allTracks).includes(index),
												),
											);
										}}
									/>
									<span>
										{audioTrackLabel(stream, position, t, i18n.language)}
										<span className="block text-muted-foreground">
											{t(`compatibility.states.${compatibility.status}`)}
										</span>
									</span>
								</label>
							))}
						</fieldset>
						{selection?.length === 0 && (
							<p className="text-sm text-muted-foreground">
								{t("audioTracks.noneDescription")}
							</p>
						)}
						<Button
							disabled={action.busy || pending || task?.status === "ready"}
							onClick={start}
						>
							{t(
								action.busy
									? "preparation.checking"
									: pending
										? `preparation.status.${task.status}`
										: task?.status === "ready"
											? "preparation.status.ready"
											: "preparation.start",
							)}
						</Button>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}
