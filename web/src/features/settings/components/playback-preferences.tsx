import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../shared/components/ui/card.js";
import { Checkbox } from "../../../shared/components/ui/checkbox.js";
import { Label } from "../../../shared/components/ui/label.js";
import { Switch } from "../../../shared/components/ui/switch.js";
import { toast } from "../../../shared/components/ui/toast.js";
import { useAutomaticContinuation } from "../hooks/use-automatic-continuation.js";

export function AutomaticContinuationSetting({
	useSwitch = false,
}: {
	useSwitch?: boolean;
}) {
	const { t } = useTranslation();
	const id = useId();
	const Control = useSwitch ? Switch : Checkbox;
	const preference = useAutomaticContinuation();
	return (
		<div className="space-y-2">
			<div className="flex min-h-11 items-center gap-2">
				<Control
					id={id}
					checked={preference.enabled}
					aria-describedby={preference.error ? `${id}-error` : undefined}
					onCheckedChange={(enabled) => {
						try {
							preference.setEnabled(enabled);
							console.info("[Settings] Playback preference saved.", {
								enabled,
							});
							toast.add({
								id: "playback-preferences-save",
								type: "success",
								title: t("playbackPreferences.saved"),
							});
						} catch {
							console.warn("[Settings] Playback preference save failed.");
							toast.add({
								id: "playback-preferences-save",
								type: "error",
								title: t("playbackPreferences.storageError"),
							});
						}
					}}
				/>
				<Label htmlFor={id} className="min-h-11 cursor-pointer">
					{t("player.continuation.automatic")}
				</Label>
			</div>
			{preference.error && (
				<p id={`${id}-error`} role="alert" className="field-error">
					{t("playbackPreferences.storageError")}
				</p>
			)}
		</div>
	);
}

export function PlaybackPreferencesSettings() {
	const { t } = useTranslation();
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<CardTitle>{t("playbackPreferences.title")}</CardTitle>
				<CardDescription>{t("playbackPreferences.scope")}</CardDescription>
			</CardHeader>
			<CardContent>
				<AutomaticContinuationSetting useSwitch />
			</CardContent>
		</Card>
	);
}
