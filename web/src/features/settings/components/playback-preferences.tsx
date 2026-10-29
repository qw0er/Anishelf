import { useId, useState } from "react";
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
	const [saveFailed, setSaveFailed] = useState(false);
	return (
		<div className="space-y-2">
			<div className="flex min-h-11 items-center gap-2">
				<Control
					id={id}
					checked={preference.enabled}
					onCheckedChange={(enabled) => {
						try {
							preference.setEnabled(enabled);
							setSaveFailed(false);
						} catch {
							setSaveFailed(true);
						}
					}}
				/>
				<Label htmlFor={id} className="min-h-11 cursor-pointer">
					{t("player.continuation.automatic")}
				</Label>
			</div>
			{(preference.error || saveFailed) && (
				<p role="alert" className="field-error">
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
