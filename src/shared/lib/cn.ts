import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names with tailwind-merge to avoid conflicting utilities.
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

