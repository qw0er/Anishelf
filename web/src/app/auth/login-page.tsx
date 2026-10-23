import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { clearCompatibilityCache } from "../../features/media/public.js";
import { clearAuthToken, request } from "../../shared/api/client.js";
import { queryClient } from "../../shared/api/query-client.js";
import { Button } from "../../shared/components/ui/button.js";
import { Input } from "../../shared/components/ui/input.js";
import { loginReturnPath } from "./return-path.js";
export function LoginPage() {
	const { t } = useTranslation();
	const [params] = useSearchParams();
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	return (
		<main className="min-h-screen grid place-items-center p-6 bg-background">
			<form
				className="w-full max-w-sm rounded-lg border p-6 space-y-4"
				onSubmit={async (event) => {
					event.preventDefault();
					setPending(true);
					setError("");
					try {
						const normalizedPassword = password.trim();
						await request(
							"/api/auth/login",
							"POST",
							{},
							{ password: normalizedPassword },
						);
						queryClient.clear();
						await clearCompatibilityCache();
						clearAuthToken();
						window.location.replace(
							loginReturnPath(params.get("returnTo"), window.location.origin),
						);
					} catch (error) {
						setError(
							error instanceof Error ? error.message : t("auth.login.failed"),
						);
						setPending(false);
					}
				}}
			>
				<h1 className="text-2xl font-semibold">{t("auth.login.title")}</h1>
				<p className="text-sm text-muted-foreground">
					{t("auth.login.description")}
				</p>
				<label htmlFor="login-password" className="block space-y-2">
					<span>{t("auth.login.password")}</span>
					<Input
						id="login-password"
						type="password"
						autoComplete="current-password"
						required
						maxLength={256}
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						disabled={pending}
					/>
				</label>
				{error && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
				<Button type="submit" disabled={pending} className="w-full">
					{pending ? t("auth.login.signingIn") : t("auth.login.signIn")}
				</Button>
			</form>
		</main>
	);
}
