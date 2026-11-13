import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { request } from "../../shared/api/client.js";
import { webConnection } from "../../shared/api/connection.js";
import { Button } from "../../shared/components/ui/button.js";
import { FieldError } from "../../shared/components/ui/field.js";
import { Input } from "../../shared/components/ui/input.js";
import { Spinner } from "../../shared/components/ui/spinner.js";
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
						webConnection.dispose();
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
				<h1 className="page-title">{t("auth.login.title")}</h1>
				<p className="text-sm text-muted-foreground">
					{t("auth.login.description")}
				</p>
				<label htmlFor="login-password" className="block space-y-2">
					<span className="field-label">{t("auth.login.password")}</span>
					<Input
						id="login-password"
						aria-invalid={Boolean(error) || undefined}
						aria-describedby={error ? "login-password-error" : undefined}
						type="password"
						autoComplete="current-password"
						required
						maxLength={256}
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						disabled={pending}
					/>
				</label>
				<FieldError id="login-password-error">{error}</FieldError>
				<Button
					type="submit"
					disabled={pending}
					aria-busy={pending}
					className="w-full"
				>
					<span className="relative">
						<span className={pending ? "absolute -left-6 top-0.5" : "hidden"}>
							<Spinner />
						</span>
						{t("auth.login.signIn")}
					</span>
				</Button>
			</form>
		</main>
	);
}
