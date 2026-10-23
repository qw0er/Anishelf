import { useState } from "react";
import { useTranslation } from "react-i18next";
import { clearCompatibilityCache } from "../../features/media/public.js";
import { clearAuthToken, request } from "../../shared/api/client.js";
import { queryClient } from "../../shared/api/query-client.js";
import { Button } from "../../shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../shared/components/ui/card.js";
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
				<CardTitle>{t("auth.security.title")}</CardTitle>
				<CardDescription>{t("auth.security.description")}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<form
					className="space-y-4"
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
					<label htmlFor="current-password" className="block space-y-2">
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
					<label htmlFor="new-password" className="block space-y-2">
						<span>{t("auth.security.newPassword")}</span>
						<Input
							id="new-password"
							type="password"
							autoComplete="new-password"
							required
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							disabled={pending}
						/>
					</label>
					<label htmlFor="confirm-password" className="block space-y-2">
						<span>{t("auth.security.confirmPassword")}</span>
						<Input
							id="confirm-password"
							type="password"
							autoComplete="new-password"
							required
							value={confirmation}
							onChange={(event) => setConfirmation(event.target.value)}
							disabled={pending}
						/>
					</label>
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<Button type="submit" disabled={pending}>
						{t("auth.security.changePassword")}
					</Button>
				</form>
				<Button
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
				>
					{t("auth.security.signOut")}
				</Button>
			</CardContent>
		</Card>
	);
}
