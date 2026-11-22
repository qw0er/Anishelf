import type { LibmediaPlayerError } from "libmedia-react-player";

export type PlaybackFailure = Pick<
	LibmediaPlayerError,
	"reason" | "httpStatus"
>;
