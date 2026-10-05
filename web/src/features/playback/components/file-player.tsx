import { ArrowLeft, Info, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
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
import { usePreparedPlayback } from "../../preparation/public.js";
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
	const { t } = useTranslation();

	const playback = usePlaybackSession(data.file.id, playbackPolicy);
	const compatibility = useMediaCompatibility(
		data.file.id,
		playback.session?.sourceVersion,
		originalCompatibilityKey(data.file, compatibilityScope),
	);
	const unsupported =
		!compatibility.loading &&
		compatibility.result?.direct.status === "unsupported";
	const prepared = usePreparedPlayback(
		data.file.id,
		compatibility.result?.sourceVersion,
		unsupported,
	);
	const preparedCurrent = unsupported ? prepared.task : null;
	const [compatibilityOpen, setCompatibilityOpen] = useState(false);

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
			<h1 className="page-title">{data.file.name}</h1>
			{(compatibility.loading || (unsupported && prepared.loading)) && (
				<div role="status" aria-label={t("compatibility.checking")}>
					<Skeleton className="aspect-video w-full" />
				</div>
			)}
			{unsupported && !prepared.loading && !preparedCurrent && (
				<div className="space-y-3 rounded-md border p-6">
					<p role="status">
						{t(
							prepared.listError
								? "errors.requestFailed"
								: prepared.pending
									? "preparation.waitForCopy"
									: prepared.error
										? "preparation.copyUnsupported"
										: "preparation.required",
						)}
					</p>
					<Link
						className={buttonStyles("outline")}
						to={directoryPath(returnDirectoryId || data.file.parentId)}
					>
						{t("navigation.backToFiles")}
					</Link>
					<Button variant="outline" onClick={prepared.retry}>
						{t("compatibility.recheck")}
					</Button>
				</div>
			)}
			{!compatibility.loading && !unsupported && !compatibility.canAttempt && (
				<div className="space-y-3 rounded-md border p-6">
					<p role="status">
						{t(
							compatibility.error
								? "compatibility.failed"
								: "compatibility.unknown",
						)}
					</p>
					<Button variant="outline" onClick={compatibility.retry}>
						{t("compatibility.recheck")}
					</Button>
					<Button onClick={compatibility.tryDirect}>
						{t("compatibility.tryDirect")}
					</Button>
				</div>
			)}
			{preparedCurrent && (
				<p className="text-sm text-muted-foreground">
					{t("preparation.playing")}
				</p>
			)}
			{(preparedCurrent || compatibility.canAttempt) && (
				<VideoPlayer
					key={`video:${data.file.id}:${preparedCurrent?.artifactId ?? "original"}`}
					{...data}
					subtitlePolicy={subtitlePolicy}
					playbackUrl={
						preparedCurrent?.playbackUrl ??
						playback.session?.plan.playbackUrl ??
						data.playbackUrl
					}
					onMedia={playback.attach}
					onPlaybackFailure={compatibility.failed}
					expectsVideo={Boolean(compatibility.result?.selectedVideo)}
				/>
			)}
			<div className="action-row">
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
									{!unsupported && !compatibility.canAttempt && (
										<Button
											type="button"
											onClick={() => {
												compatibility.tryDirect();
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
