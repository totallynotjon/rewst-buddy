// Request types
export interface AddSessionRequest {
	action: 'addSession';
	cookies: string;
}

// Response types
export interface SuccessResponse {
	success: true;
	message: string;
	sessionLabel?: string;
	orgIds?: string[];
}

export interface ErrorResponse {
	success: false;
	error: string;
}

export type Response = SuccessResponse | ErrorResponse;

// Server configuration
export interface ServerConfig {
	enabled: boolean;
	port: number;
	host: string;
}
