const EU_SIZE_TO_LENGTH_AND_WIDTH = [
	{ eu: 30, footLengthCm: 18.7, standardWidthCm: 7.2 },
	{ eu: 31, footLengthCm: 19.3, standardWidthCm: 7.4 },
	{ eu: 32, footLengthCm: 20.0, standardWidthCm: 7.6 },
	{ eu: 33, footLengthCm: 20.7, standardWidthCm: 7.8 },
	{ eu: 34, footLengthCm: 21.3, standardWidthCm: 8.0 },
	{ eu: 35, footLengthCm: 22.0, standardWidthCm: 8.2 },
	{ eu: 36, footLengthCm: 22.7, standardWidthCm: 8.4 },
	{ eu: 37, footLengthCm: 23.3, standardWidthCm: 8.6 },
	{ eu: 38, footLengthCm: 24.0, standardWidthCm: 8.8 },
	{ eu: 39, footLengthCm: 24.7, standardWidthCm: 9.0 },
	{ eu: 40, footLengthCm: 25.3, standardWidthCm: 9.2 },
	{ eu: 41, footLengthCm: 26.0, standardWidthCm: 9.4 },
	{ eu: 42, footLengthCm: 26.7, standardWidthCm: 9.6 },
	{ eu: 43, footLengthCm: 27.3, standardWidthCm: 9.8 },
	{ eu: 44, footLengthCm: 28.0, standardWidthCm: 10.0 },
	{ eu: 45, footLengthCm: 28.7, standardWidthCm: 10.2 },
	{ eu: 46, footLengthCm: 29.3, standardWidthCm: 10.4 },
	{ eu: 47, footLengthCm: 30.0, standardWidthCm: 10.6 },
	{ eu: 48, footLengthCm: 30.7, standardWidthCm: 10.8 },
	{ eu: 49, footLengthCm: 31.3, standardWidthCm: 11.0 },
	{ eu: 50, footLengthCm: 32.0, standardWidthCm: 11.2 },
	{ eu: 51, footLengthCm: 32.7, standardWidthCm: 11.4 },
	{ eu: 52, footLengthCm: 33.3, standardWidthCm: 11.6 },
	{ eu: 53, footLengthCm: 34.0, standardWidthCm: 11.8 },
	{ eu: 54, footLengthCm: 34.7, standardWidthCm: 12.0 },
	{ eu: 55, footLengthCm: 35.3, standardWidthCm: 12.2 },
	{ eu: 56, footLengthCm: 36.0, standardWidthCm: 12.4 },
	{ eu: 57, footLengthCm: 36.7, standardWidthCm: 12.6 },
	{ eu: 58, footLengthCm: 37.3, standardWidthCm: 12.8 },
	{ eu: 59, footLengthCm: 38.0, standardWidthCm: 13.0 },
	{ eu: 60, footLengthCm: 38.7, standardWidthCm: 13.2 },
] as const;

const MIN_EU_SIZE = EU_SIZE_TO_LENGTH_AND_WIDTH[0].eu;
const MAX_EU_SIZE = EU_SIZE_TO_LENGTH_AND_WIDTH[EU_SIZE_TO_LENGTH_AND_WIDTH.length - 1].eu;
const MIN_FOOT_LENGTH_MM = EU_SIZE_TO_LENGTH_AND_WIDTH[0].footLengthCm * 10;
const MAX_FOOT_LENGTH_MM = EU_SIZE_TO_LENGTH_AND_WIDTH[EU_SIZE_TO_LENGTH_AND_WIDTH.length - 1].footLengthCm * 10;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function roundToHalf(value: number) {
	return Math.round(value * 2) / 2;
}

export function estimateEuShoeSizeFromFootLengthMm(footLengthMm: number): number | null {
	if (!Number.isFinite(footLengthMm) || footLengthMm < 160 || footLengthMm > 390) {
		return null;
	}

	const clampedLengthMm = clamp(footLengthMm, MIN_FOOT_LENGTH_MM, MAX_FOOT_LENGTH_MM);
	const clampedLengthCm = clampedLengthMm / 10;

	for (let index = 0; index < EU_SIZE_TO_LENGTH_AND_WIDTH.length - 1; index++) {
		const lower = EU_SIZE_TO_LENGTH_AND_WIDTH[index];
		const upper = EU_SIZE_TO_LENGTH_AND_WIDTH[index + 1];
		if (clampedLengthCm < lower.footLengthCm || clampedLengthCm > upper.footLengthCm) {
			continue;
		}

		const span = Math.max(1e-6, upper.footLengthCm - lower.footLengthCm);
		const fraction = (clampedLengthCm - lower.footLengthCm) / span;
		return roundToHalf(lower.eu + (upper.eu - lower.eu) * fraction);
	}

	if (clampedLengthCm <= EU_SIZE_TO_LENGTH_AND_WIDTH[0].footLengthCm) {
		return MIN_EU_SIZE;
	}

	return MAX_EU_SIZE;
}

export function getStandardWidthMmForEuSize(euSize: number): number {
	const clamped = clamp(euSize, MIN_EU_SIZE, MAX_EU_SIZE);
	const lowerSize = Math.floor(clamped);
	const upperSize = Math.ceil(clamped);
	const lower = EU_SIZE_TO_LENGTH_AND_WIDTH[lowerSize - MIN_EU_SIZE];
	const upper = EU_SIZE_TO_LENGTH_AND_WIDTH[upperSize - MIN_EU_SIZE];

	if (!lower || !upper) {
		return 92;
	}

	if (lower.eu === upper.eu) {
		return lower.standardWidthCm * 10;
	}

	const fraction = (clamped - lower.eu) / (upper.eu - lower.eu);
	const widthCm = lower.standardWidthCm + (upper.standardWidthCm - lower.standardWidthCm) * fraction;
	return widthCm * 10;
}

export function getStandardWidthForFootLengthMm(footLengthMm: number): {
	euSize: number;
	standardWidthMm: number;
} | null {
	const euSize = estimateEuShoeSizeFromFootLengthMm(footLengthMm);
	if (euSize === null) {
		return null;
	}

	return {
		euSize,
		standardWidthMm: getStandardWidthMmForEuSize(euSize),
	};
}

export { EU_SIZE_TO_LENGTH_AND_WIDTH };