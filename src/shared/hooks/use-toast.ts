/**
 * Toast notification hook
 * Placeholder for future toast implementation
 */

export function useToast() {
	return {
		toast: (message: string, variant?: 'success' | 'error' | 'info') => {
			console.log(`[${variant || 'info'}] ${message}`);
			// TODO: Implement toast notifications
		},
	};
}

