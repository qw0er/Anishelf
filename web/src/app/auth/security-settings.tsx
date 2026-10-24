import { KeyRound, LogOut } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { clearCompatibilityCache } from "../../features/media/public.js";
import { clearAuthToken, request } from "../../shared/api/client.js";
import { queryClient } from "../../shared/api/query-client.js";
import { ActionButton } from "../../shared/components/ui/action-button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../shared/components/ui/card.js";
import { FieldHelp } from "../../shared/components/ui/field-help.js";
import { Input } from "../../shared/components/ui/input.js";
export function SecuritySettings() {
	const { t } = useTranslation();
	const [currentPassword, setCurrent] = useState("");
	const [password, setPassword] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const leave = async () => {
		clearAuthToken();
		queryClient.clear();
		await clearCompatibilityCache();
		window.location.replace("/login");
	};
	return (
		<Card className="settings-section lg:grid">
			<CardHeader>
				<div className="flex items-center gap-1">
					<CardTitle>{t("auth.security.title")}</CardTitle>
					<FieldHelp
						label={t("auth.security.linksHelpLabel")}
						help={t("auth.security.linksHelp")}
					/>
				</div>
				<CardDescription>{t("auth.security.description")}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<form
					id="security-password-form"
					className="grid gap-3 sm:grid-cols-2"
					onSubmit={async (event) => {
						event.preventDefault();
						setError("");
						const nextPassword = password.trim();
						if (nextPassword !== confirmation.trim()) {
							setError(t("auth.security.passwordsDoNotMatch"));
							return;
						}
						if ([...nextPassword].length < 8) {
							setError(t("auth.security.passwordTooShort"));
							return;
						}
						setPending(true);
						try {
							await request(
								"/api/auth/password",
								"PUT",
								{},
								{
									currentPassword: currentPassword.trim(),
									password: nextPassword,
								},
							);
							await leave();
						} catch (error) {
							setError(
								error instanceof Error
									? error.message
									: t("auth.security.changeFailed"),
							);
							setPending(false);
						}
					}}
				>
					<label
						htmlFor="current-password"
						className="block space-y-2 sm:col-span-2"
					>
						<span>{t("auth.security.currentPassword")}</span>
						<Input
							id="current-password"
							type="password"
							autoComplete="current-password"
							required
							value={currentPassword}
							onChange={(event) => setCurrent(event.target.value)}
							disabled={pending}
						/>
					</label>
					<div className="space-y-2">
						<div className="flex min-h-6 items-center gap-1">
							<label htmlFor="new-password" className="text-sm">
								{t("auth.security.newPassword")}
							</label>
							<FieldHelp
								label={t("auth.security.passwordHelpLabel")}
								help={t("auth.security.passwordHelp")}
							/>
						</div>
						<Input
							id="new-password"
							type="password"
							autoComplete="new-password"
							required
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							disabled={pending}
						/>
					</div>
					<div className="space-y-2">
						<div className="flex min-h-6 items-center">
							<label htmlFor="confirm-password" className="text-sm">
								{t("auth.security.confirmPassword")}
							</label>
						</div>
						<Input
							id="confirm-password"
							type="password"
							autoComplete="new-password"
							required
							value={confirmation}
							onChange={(event) => setConfirmation(event.target.value)}
							disabled={pending}
						/>
					</div>
					{error && (
						<p role="alert" className="text-sm text-destructive sm:col-span-2">
							{error}
						</p>
					)}
				</form>
				<div className="action-row">
					<ActionButton
						icon={KeyRound}
						label={t("auth.security.changePassword")}
						shortLabel={t("auth.security.changePassword")}
						type="submit"
						form="security-password-form"
						aria-busy={pending}
						disabled={pending}
					/>
					<ActionButton
						icon={LogOut}
						label={t("auth.security.signOut")}
						shortLabel={t("auth.security.signOut")}
						variant="outline"
						disabled={pending}
						onClick={async () => {
							setPending(true);
							try {
								await request("/api/auth/logout", "POST");
								await leave();
							} catch (error) {
								setError(
									error instanceof Error
										? error.message
										: t("auth.security.signOutFailed"),
								);
								setPending(false);
							}
						}}
					/>
				</div>
			</CardContent>
		</Card>
	);
}
