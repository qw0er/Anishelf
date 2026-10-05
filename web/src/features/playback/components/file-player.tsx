import { ArrowLeft, Info, Play, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import type { FileResponse } from "../../../api/contracts.js";
import { Button, buttonStyles } from "../../../components/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../../../components/ui/dialog.js";
import { Skeleton } from "../../../components/ui/skeleton.js";
import {
	playbackPolicy,
	subtitlePolicy,
} from "../../../config/media-policy.js";
import { originalCompatibilityKey } from "../../../lib/media-compatibility.js";
import { directoryPath } from "../../../routes/paths.js";
import {
	audioTrackLabel,
	PreparationButton,
	usePreparedPlayback,
} from "../../preparation/public.js";
import { useMediaCompatibility } from "../hooks/use-media-compatibility.js";
import { usePlaybackSession } from "../hooks/use-playback-session.js";
import MediaLink from "./media-link.js";
import VideoPlayer from "./video-player.js";

export default function FilePlayer({
	data,

	returnDirectoryId,
	onRetry,
	compatibilityScope = "",
}: {
	data: FileResponse;
	returnDirectoryId: string | null;
	onRetry(): void;
	compatibilityScope?: string;
}) {
	const { t, i18n } = useTranslation();
	const [searchParams, setSearchParams] = useSearchParams();
	const audio = searchParams.get("audio");
	const audioStreamIndices = useMemo(
		() =>
			audio === null
				? undefined
				: audio === ""
					? []
					: audio.split(",").map(Number),
		[audio],
	);

	const playback = usePlaybackSession(data.file.id, playbackPolicy);
	const compatibility = useMediaCompatibility(
		data.file.id,
		playback.session?.sourceVersion,
		originalCompatibilityKey(data.file, compatibilityScope),
	);
	const unsupported =
		!compatibility.loading &&
		compatibility.result?.direct.status === "unsupported";
	const audioTracks = compatibility.result?.audioTracks ?? [];
	const allAudioStreamIndices = audioTracks.map(({ stream }) => stream.index);
	const originIdentity = JSON.stringify([data.file.id, audio]);
	const [originAttempt, setOriginAttempt] = useState<string | null>(null);
	const tryingOrigin = originAttempt === originIdentity;
	const [originRevision, setOriginRevision] = useState(0);
	function tryOrigin() {
		setOriginAttempt(originIdentity);
		setOriginRevision((revision) => revision + 1);
		compatibility.tryDirect();
	}
	const canAttempt = tryingOrigin || compatibility.canAttempt;
	const requiresCopy =
		!tryingOrigin && (unsupported || audioStreamIndices !== undefined);
	const prepared = usePreparedPlayback(
		data.file.id,
		compatibility.result?.sourceVersion,
		unsupported || audioStreamIndices !== undefined || audioTracks.length > 1,
		audioStreamIndices,
		compatibility.result ? allAudioStreamIndices : undefined,
	);
	const preparedCurrent = tryingOrigin ? null : prepared.task;
	const [compatibilityOpen, setCompatibilityOpen] = useState(false);

	const blocked =
		!compatibility.loading &&
		!preparedCurrent &&
		((requiresCopy && !prepared.loading) || (!requiresCopy && !canAttempt));
	function recheck() {
		compatibility.retry();
		prepared.retry();
	}
	const preparationAction = (
		<PreparationButton
			key={audio ?? "all"}
			fileId={data.file.id}
			loading={compatibility.loading}
			result={compatibility.result}
			error={compatibility.error}
			onRecheck={recheck}
			showLabel
			tasks={prepared.tasks}
			onPrepared={(task) => {
				if (task.audioStreamIndices === undefined) return;
				const next = new URLSearchParams(searchParams);
				if (
					JSON.stringify(task.audioStreamIndices) ===
					JSON.stringify(allAudioStreamIndices)
				)
					next.delete("audio");
				else next.set("audio", task.audioStreamIndices.join(","));
				setSearchParams(next, { replace: true });
			}}
			{...(audioStreamIndices !== undefined ? { audioStreamIndices } : {})}
		/>
	);

	return (
		<section className="stack-page" aria-label={t("player.label")}>
			<div className="action-row">
				<Link
					className={buttonStyles("outline")}
					to={directoryPath(returnDirectoryId || data.file.parentId)}
				>
					<ArrowLeft size={16} aria-hidden="true" />
					{t("navigation.backToFiles")}
				</Link>
				<Button type="button" variant="outline" onClick={onRetry}>
					<RefreshCw size={16} aria-hidden="true" />
					{t("player.retry")}
				</Button>
			</div>
			{(compatibility.loading || (requiresCopy && prepared.loading)) && (
				<div role="status" aria-label={t("compatibility.checking")}>
					<Skeleton className="aspect-video w-full" />
				</div>
			)}
			{blocked && (
				<section
					className="space-y-3 rounded-md border p-6"
					aria-labelledby="playback-unavailable-title"
				>
					<h2 id="playback-unavailable-title" className="text-lg font-semibold">
						{t("player.unavailableTitle")}
					</h2>
					<p role="status" className="text-sm text-muted-foreground">
						{t(
							compatibility.error
								? "compatibility.failed"
								: requiresCopy && prepared.listError
									? "errors.requestFailed"
									: requiresCopy && prepared.pending
										? "preparation.waitForCopy"
										: requiresCopy && prepared.error
											? "preparation.copyUnsupported"
											: unsupported
												? "compatibility.unsupported"
												: audioStreamIndices !== undefined
													? "audioTracks.copyRequired"
													: "compatibility.unknown",
						)}
					</p>
					<div className="action-row">
						<Button variant="outline" onClick={recheck}>
							<RefreshCw className="size-4" aria-hidden="true" />
							{t("compatibility.recheck")}
						</Button>
						<Button variant="outline" onClick={tryOrigin}>
							<Play className="size-4" aria-hidden="true" />
							{t("compatibility.tryDirect")}
						</Button>
						{preparationAction}
					</div>
				</section>
			)}
			<h1 className="page-title">{data.file.name}</h1>
			{preparedCurrent && (
				<p className="text-sm text-muted-foreground">
					{t("preparation.playing")}
				</p>
			)}
			{(preparedCurrent || (!requiresCopy && canAttempt)) && (
				<VideoPlayer
					key={`video:${data.file.id}:${preparedCurrent?.artifactId ?? "original"}:${tryingOrigin ? originRevision : 0}`}
					{...data}
					subtitlePolicy={subtitlePolicy}
					playbackUrl={
						tryingOrigin
							? data.originalMediaUrl
							: (preparedCurrent?.resource?.url ??
								(playback.session?.plan.mode === "direct"
									? playback.session.plan.resource.url
									: undefined) ??
								data.originalMediaUrl)
					}
					{...(preparedCurrent?.resource
						? { timeline: preparedCurrent.resource.timeline }
						: playback.session?.plan.mode === "direct"
							? { timeline: playback.session.plan.resource.timeline }
							: {})}
					onMedia={playback.attach}
					onPlaybackFailure={compatibility.failed}
					expectsVideo={Boolean(compatibility.result?.selectedVideo)}
				/>
			)}
			{audioTracks.length > 1 && (
				<div className="min-w-0">
					<label className="flex flex-wrap items-center gap-3">
						<span className="font-medium">{t("audioTracks.playback")}</span>
						<select
							className="min-w-0 max-w-full rounded-md border bg-background px-3 py-2 text-sm"
							value={audio ?? "all"}
							onChange={(event) => {
								const next = new URLSearchParams(searchParams);
								if (event.target.value === "all") next.delete("audio");
								else next.set("audio", event.target.value);
								setSearchParams(next, { replace: true });
							}}
						>
							<option value="all">{t("audioTracks.defaultPlayback")}</option>
							{audioTracks.map(({ stream }, position) => (
								<option key={stream.index} value={String(stream.index)}>
									{audioTrackLabel(stream, position, t, i18n.language)}
								</option>
							))}
							{audio?.includes(",") && (
								<option value={audio}>
									{t("audioTracks.selected", {
										count: audioStreamIndices?.length,
									})}
								</option>
							)}
							<option value="">{t("audioTracks.none")}</option>
						</select>
					</label>
				</div>
			)}
			<div className="action-row">
				{!blocked && !preparedCurrent && preparationAction}
				<Dialog open={compatibilityOpen} onOpenChange={setCompatibilityOpen}>
					<DialogTrigger render={<Button type="button" variant="outline" />}>
						<Info size={16} aria-hidden="true" />
						{t("compatibility.showInfo")}
					</DialogTrigger>
					<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
						<DialogHeader>
							<DialogTitle>{t("compatibility.label")}</DialogTitle>
						</DialogHeader>
						<div className="space-y-2">
							<p role="status">
								{t(
									compatibility.loading
										? "compatibility.checking"
										: compatibility.error
											? "compatibility.failed"
											: `compatibility.${compatibility.result?.direct.status ?? "unknown"}`,
								)}
							</p>
							{compatibility.result && (
								<>
									<p className="text-sm text-muted-foreground">
										{t(
											`compatibility.reasons.${compatibility.result.direct.reason}`,
											{ defaultValue: t("compatibility.reasonUnknown") },
										)}
									</p>
									<details className="text-sm">
										<summary>{t("compatibility.details")}</summary>
										<dl className="mt-2 space-y-2">
											{(["container", "video", "audio"] as const).map(
												(kind) => (
													<div key={kind}>
														<dt className="font-medium">
															{t(`compatibility.kinds.${kind}`)}
														</dt>
														<dd>
															{t(
																`compatibility.states.${compatibility.result?.[kind].status}`,
															)}{" "}
															—{" "}
															{t(
																`compatibility.reasons.${compatibility.result?.[kind].reason}`,
																{
																	defaultValue: t(
																		"compatibility.reasonUnknown",
																	),
																},
															)}
														</dd>
													</div>
												),
											)}
										</dl>
									</details>

									{audioTracks.length > 0 && (
										<dl className="space-y-3 text-sm">
											{audioTracks.map(
												({ stream, compatibility: decision }, position) => (
													<div key={stream.index}>
														<dt className="font-medium">
															{audioTrackLabel(
																stream,
																position,
																t,
																i18n.language,
															)}
														</dt>
														<dd>
															{t(`compatibility.states.${decision.status}`)} —{" "}
															{t(`compatibility.reasons.${decision.reason}`, {
																defaultValue: t("compatibility.reasonUnknown"),
															})}
														</dd>
													</div>
												),
											)}
										</dl>
									)}
									{compatibility.result.warnings.includes(
										"playback-may-not-be-smooth",
									) && <p>{t("compatibility.performanceWarning")}</p>}
								</>
							)}
							{compatibility.runtimeFailed && (
								<p role="alert">{t("compatibility.runtimeFailed")}</p>
							)}
							{!compatibility.loading && (
								<div className="action-row">
									<Button
										type="button"
										variant="outline"
										onClick={compatibility.retry}
									>
										{t("compatibility.recheck")}
									</Button>
									{(!tryingOrigin || compatibility.runtimeFailed) && (
										<Button
											type="button"
											onClick={() => {
												tryOrigin();
												setCompatibilityOpen(false);
											}}
										>
											{t("compatibility.tryDirect")}
										</Button>
									)}
								</div>
							)}
						</div>
					</DialogContent>
				</Dialog>
				<MediaLink key={`link:${data.file.id}`} fileId={data.file.id} />
			</div>
		</section>
	);
}
