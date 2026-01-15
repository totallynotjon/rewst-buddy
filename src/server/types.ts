// Request types
export interface AddSessionRequest {
	action: 'addSession';
	cookies: string;
}
export interface OpenTemplateRequest {
	action: 'openTemplate';
	orgId: string;
	templateId: string;
}

// Response types
export interface SuccessResponse {
	success: true;
	message: string;
	sessionLabel?: string;
}

export interface ErrorResponse {
	success: false;
	error: string;
}

export type BrowserRequest = AddSessionRequest | OpenTemplateRequest;

export type Response = SuccessResponse | ErrorResponse;

// Server configuration
export interface ServerConfig {
	enabled: boolean;
	port: number;
	host: string;
}
