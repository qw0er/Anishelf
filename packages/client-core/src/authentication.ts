/** Session information shared by Web and native hosts. Credentials stay in the host. */
export interface ClientSession {
	authenticated: boolean;
}

export interface ClientAuthentication {
	signIn(password: string): Promise<void>;
	getSession(): Promise<ClientSession>;
	signOut(): Promise<void>;
	changePassword?(currentPassword: string, password: string): Promise<void>;
}
