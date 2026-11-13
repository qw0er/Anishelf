/** FFmpeg options retain their authored order; null represents a valueless flag. */
export type EncodingOptions = Record<string, string | number | null>;
export interface VideoEncoding {
	encoder: string;
	codec: string;
	pixelFormat?: string | undefined;
	maxWidth?: number | undefined;
	maxHeight?: number | undefined;
	maxFrameRate?: number | undefined;
	options?: EncodingOptions | undefined;
	filters?: readonly string[] | undefined;
}
export interface AudioEncoding {
	encoder: string;
	codec: string;
	channels?: number | undefined;
	sampleRate?: number | undefined;
	options?: EncodingOptions | undefined;
	filters?: readonly string[] | undefined;
}
export interface EncodingValidation {
	status: "recognized" | "unsupported" | "unverified";
	issues: { field: string; message: string }[];
}
