/**
 * API Types and Interfaces
 */

// Pagination
export interface PaginatedResponse<T> {
	data: T[];
	pagination: {
		page: number;
		pageSize: number;
		total: number;
		totalPages: number;
	};
}

// Error Response
export interface ErrorResponse {
	error: {
		code: string;
		message: string;
		details?: unknown;
		timestamp: string;
	};
}

// Common API Response
export type ApiResponse<T> = T | ErrorResponse;

