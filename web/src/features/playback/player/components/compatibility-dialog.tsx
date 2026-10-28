import { useTranslation } from "react-i18next";
import type { PlaybackAssetChoice } from "../../../../shared/api/contracts.js";
import { Button } from "../../../../shared/components/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../../../../shared/components/ui/dialog.js";
import { audioTrackLabel } from "../../../media/public.js";
import type { usePlaybackController } from "../hooks/use-playback-controller.js";

function AssetReport({ choice }: { choice: PlaybackAssetChoice }) {
	const { t, i18n } = useTranslation();
	const { asset, compatibility } = choice;
	const selectedAudio = asset.audioTracks.find(
		(track) => track.stream.index === choice.audio?.streamIndex,
	)?.stream;
	return (
		<div className="space-y-3">
			<p>
				{choice.unavailableReason
					? t(`compatibility.reasons.${choice.unavailableReason}`, {
							defaultValue: t("compatibility.reasonUnknown"),
						})
					: `${t(`compatibility.states.${compatibility.overall.status}`)} — ${t(`compatibility.reasons.${compatibility.overall.reason}`, { defaultValue: t("compatibility.reasonUnknown") })}`}
			</p>
			<dl className="space-y-2 text-sm">
				{(["container", "video", "audio"] as const).map((kind) => (
					<div key={kind}>
						<dt className="font-medium">
							{t(`compatibility.kinds.${kind}`)} ·{" "}
							{kind === "container"
								? asset.container?.toUpperCase()
								: kind === "video"
									? asset.video?.codec?.toUpperCase()
									: (selectedAudio?.codec?.toUpperCase() ??
										t("audioTracks.none"))}
						</dt>
						<dd>
							{t(`compatibility.states.${compatibility[kind].status}`)} —{" "}
							{t(`compatibility.reasons.${compatibility[kind].reason}`, {
								defaultValue: t("compatibility.reasonUnknown"),
							})}
						</dd>
					</div>
				))}
			</dl>
			{asset.audioTracks.length > 0 && (
				<ul className="space-y-2 text-sm">
					{asset.audioTracks.map(({ stream }, position) => (
						<li key={stream.index}>
							{audioTrackLabel(
								{
									...stream,
									label: stream.language ? null : (stream.label ?? null),
								},
								position,
								t,
								i18n.language,
							)}
							{stream.index === choice.audio?.streamIndex
								? ` · ${t("player.selectedTrack")}`
								: ""}
						</li>
					))}
				</ul>
			)}
			{compatibility.warnings.includes("playback-may-not-be-smooth") && (
				<p>{t("compatibility.performanceWarning")}</p>
			)}
		</div>
	);
}
export function CompatibilityDialog({
	selection,
	tryOrigin,
	open,
	setOpen,
}: {
	selection: ReturnType<typeof usePlaybackController>["selection"];
	tryOrigin(): void;
	open: boolean;
	setOpen(value: boolean): void;
}) {
	const { t } = useTranslation();
	const result = selection.selection;
	const active = result?.active;
	const original = result?.choices.find(
		(choice) => choice.asset.kind === "original",
	);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{t("compatibility.label")}</DialogTitle>
				</DialogHeader>
				{selection.loading ? (
					<p role="status">{t("compatibility.checking")}</p>
				) : selection.error ? (
					<p role="alert">{t("compatibility.failed")}</p>
				) : active ? (
					<>
						<p className="font-medium">
							{t("player.currentAsset")} ·{" "}
							{t(`player.assets.${active.asset.kind}`)}
						</p>
						<section aria-label={t("player.currentAsset")}>
							<AssetReport choice={active} />
						</section>
						{original && original.asset.id !== active.asset.id && (
							<details className="text-sm">
								<summary>{t("player.sourceDetails")}</summary>
								<div className="mt-3">
									<AssetReport choice={original} />
								</div>
							</details>
						)}
					</>
				) : (
					<>
						<p role="status">{t("player.noMatchingAsset")}</p>
						{result?.choices.map((choice) => (
							<details key={choice.asset.id} className="text-sm">
								<summary>{t(`player.assets.${choice.asset.kind}`)}</summary>
								<div className="mt-3">
									<AssetReport choice={choice} />
								</div>
							</details>
						))}
					</>
				)}
				{selection.runtimeFailure && (
					<p role="alert">
						{t(`player.failures.${selection.runtimeFailure.kind}`)}
					</p>
				)}
				<div className="action-row">
					<Button variant="outline" onClick={selection.retry}>
						{t("compatibility.recheck")}
					</Button>
					<Button
						onClick={() => {
							tryOrigin();
							setOpen(false);
						}}
					>
						{t("compatibility.tryDirect")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
