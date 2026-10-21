import { useState } from "react";
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
				<CardTitle>Security</CardTitle>
				<CardDescription>
					Change the access password or sign out. Changing the password signs
					out all devices and revokes media links. External media links expire
					after 24 hours; anyone holding a link can access that file until it
					expires.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<form
					className="space-y-4"
					onSubmit={async (event) => {
						event.preventDefault();
						setError("");
						const nextPassword = password.trim();
						if (nextPassword !== confirmation.trim()) {
							setError("Passwords do not match.");
							return;
						}
						if ([...nextPassword].length < 8) {
							setError("Password must contain at least 8 characters.");
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
									: "Password change failed.",
							);
							setPending(false);
						}
					}}
				>
					<label htmlFor="current-password" className="block space-y-2">
						<span>Current password</span>
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
						<span>New password (8–128 characters, outer spaces trimmed)</span>
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
						<span>Confirm new password</span>
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
						Change password
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
								error instanceof Error ? error.message : "Sign out failed.",
							);
							setPending(false);
						}
					}}
				>
					Sign out
				</Button>
			</CardContent>
		</Card>
	);
}
