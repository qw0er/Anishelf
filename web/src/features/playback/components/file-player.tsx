import { ArrowLeft, Info, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
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
import {
	playbackPolicy,
	subtitlePolicy,
} from "../../../config/media-policy.js";
import { directoryPath } from "../../../routes/paths.js";
import { useMediaCompatibility } from "../hooks/use-media-compatibility.js";
import { usePlaybackSession } from "../hooks/use-playback-session.js";
import MediaLink from "./media-link.js";
import VideoPlayer from "./video-player.js";

export default function FilePlayer({
	data,

	returnDirectoryId,
	onRetry,
}: {
	data: FileResponse;
	returnDirectoryId: string | null;
	onRetry(): void;
}) {
	const { t } = useTranslation();
	const playback = usePlaybackSession(data.file.id, playbackPolicy);
	const compatibility = useMediaCompatibility(
		data.file.id,
		playback.session?.sourceVersion,
	);
	const [compatibilityOpen, setCompatibilityOpen] = useState(false);
	useEffect(() => {
		if (compatibility.loading) {
			setCompatibilityOpen(false);
		} else if (!compatibility.canAttempt || compatibility.runtimeFailed) {
			setCompatibilityOpen(true);
		}
	}, [
		compatibility.loading,
		compatibility.canAttempt,
		compatibility.runtimeFailed,
	]);

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
			{compatibility.canAttempt && (
				<VideoPlayer
					key={`video:${data.file.id}`}
					{...data}
					subtitlePolicy={subtitlePolicy}
					playbackUrl={playback.session?.plan.playbackUrl ?? data.playbackUrl}
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
									{compatibility.result.plans
										.filter(
											(plan) =>
												plan.target === "file" && plan.mode !== "direct",
										)
										.map((plan) => (
											<p key={plan.target} className="text-sm">
												{plan.mode === "unknown"
													? t("compatibility.preparationUnknown")
													: t("compatibility.recommendation", {
															mode: t(`compatibility.modes.${plan.mode}`),
														})}
											</p>
										))}
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
											{compatibility.result.plans.map((plan) => (
												<div key={plan.target}>
													<dt className="font-medium">
														{t(`compatibility.targets.${plan.target}`)}
													</dt>
													<dd>
														{t("compatibility.streamActions", {
															video: t(
																`compatibility.actions.${plan.videoAction}`,
															),
															audio: t(
																`compatibility.actions.${plan.audioAction}`,
															),
														})}
													</dd>
													<dd>
														{t(`compatibility.reasons.${plan.reason}`, {
															defaultValue: t("compatibility.reasonUnknown"),
														})}
													</dd>
												</div>
											))}
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
									{!compatibility.canAttempt && (
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
