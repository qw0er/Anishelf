import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../../../components/ui/dialog.js";
import { audioTrackLabel } from "../../preparation/public.js";
import type { usePlaybackController } from "../hooks/use-playback-controller.js";
export function CompatibilityDialog({
	compatibility,
	open: compatibilityOpen,
	setOpen: setCompatibilityOpen,
	tryOrigin,
	tryingOrigin,
}: {
	compatibility: ReturnType<typeof usePlaybackController>["compatibility"];
	open: boolean;
	setOpen(value: boolean): void;
	tryOrigin(): void;
	tryingOrigin: boolean;
}) {
	const { t, i18n } = useTranslation();
	const audioTracks = compatibility.result?.audioTracks ?? [];
	return (
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
									{(["container", "video", "audio"] as const).map((kind) => (
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
														defaultValue: t("compatibility.reasonUnknown"),
													},
												)}
											</dd>
										</div>
									))}
								</dl>
							</details>

							{audioTracks.length > 0 && (
								<dl className="space-y-3 text-sm">
									{audioTracks.map(
										({ stream, compatibility: decision }, position) => (
											<div key={stream.index}>
												<dt className="font-medium">
													{audioTrackLabel(stream, position, t, i18n.language)}
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
	);
}
