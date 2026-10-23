/** Private content locators; never exposed to business consumers. */
export type ReleaseDownload =
	| { kind: "magnet"; uri: string }
	| { kind: "public-torrent"; url: string }
	| {
			kind: "jackett-torrent";
			generation: string;
			indexerId: string;
			path: string;
			file: string;
	  };
