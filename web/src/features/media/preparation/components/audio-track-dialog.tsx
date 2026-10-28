import { useTranslation } from "react-i18next";
import { Button } from "../../../../shared/components/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../../../../shared/components/ui/dialog.js";
import type { PreparationSource } from "../audio-tracks.js";
import { audioTrackLabel } from "../audio-tracks.js";
export function AudioTrackDialog({
	dialogOpen,
	onOpenChange,
	tracks,
	selection,
	onSelectionChange,
	busy,
	pending,
	ready,
	status,
	onStart,
}: {
	dialogOpen: boolean;
	onOpenChange(open: boolean): void;
	tracks: PreparationSource["audioTracks"];
	selection: number[] | undefined;
	onSelectionChange(selection: number[] | undefined): void;
	busy: boolean;
	pending: boolean;
	ready: boolean;
	status: string | undefined;
	onStart(): void;
}) {
	const { t, i18n } = useTranslation();
	const allTracks = tracks.map((stream) => stream.index);
	return (
		<Dialog open={dialogOpen} onOpenChange={onOpenChange}>
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
						disabled={busy}
						onClick={() => onSelectionChange(undefined)}
					>
						{t("audioTracks.all")}
					</Button>
					<Button
						variant="outline"
						disabled={busy}
						onClick={() => onSelectionChange([])}
					>
						{t("audioTracks.none")}
					</Button>
				</div>
				<fieldset className="space-y-3">
					<legend className="sr-only">{t("audioTracks.label")}</legend>
					{tracks.map((stream, position) => (
						<label
							key={stream.index}
							className="flex items-start gap-3 text-sm"
						>
							<input
								type="checkbox"
								disabled={busy}
								className="mt-1 size-4 accent-primary"
								checked={(selection ?? allTracks).includes(stream.index)}
								onChange={(event) => {
									const checked = event.target.checked;
									onSelectionChange(
										allTracks.filter((index) =>
											index === stream.index
												? checked
												: (selection ?? allTracks).includes(index),
										),
									);
								}}
							/>
							<span>{audioTrackLabel(stream, position, t, i18n.language)}</span>
						</label>
					))}
				</fieldset>
				{selection?.length === 0 && (
					<p className="text-sm text-muted-foreground">
						{t("audioTracks.noneDescription")}
					</p>
				)}
				<Button disabled={busy || pending || ready} onClick={onStart}>
					{t(
						busy
							? "preparation.checking"
							: pending
								? `preparation.status.${status}`
								: ready
									? "preparation.status.ready"
									: "preparation.start",
					)}
				</Button>
			</DialogContent>
		</Dialog>
	);
}
