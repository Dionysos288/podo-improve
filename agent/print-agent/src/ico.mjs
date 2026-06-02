/**
 * Build a 16x16 solid-color status dot as a Windows .ico, returned as base64.
 * Avoids shipping binary icon assets and lets the tray color reflect status.
 */
export function buildStatusIcoBase64({ r, g, b }, size = 16) {
	const headerSize = 40;
	const xorSize = size * size * 4; // 32bpp BGRA, bottom-up
	const andRowBytes = Math.ceil(size / 32) * 4; // 1bpp mask padded to 32-bit rows
	const andSize = andRowBytes * size;
	const imageSize = headerSize + xorSize + andSize;

	const dir = Buffer.alloc(6 + 16);
	dir.writeUInt16LE(0, 0); // reserved
	dir.writeUInt16LE(1, 2); // type: icon
	dir.writeUInt16LE(1, 4); // count
	dir.writeUInt8(size, 6); // width
	dir.writeUInt8(size, 7); // height
	dir.writeUInt8(0, 8); // color count
	dir.writeUInt8(0, 9); // reserved
	dir.writeUInt16LE(1, 10); // planes
	dir.writeUInt16LE(32, 12); // bit count
	dir.writeUInt32LE(imageSize, 14); // bytes in resource
	dir.writeUInt32LE(6 + 16, 18); // image offset

	const header = Buffer.alloc(headerSize);
	header.writeUInt32LE(headerSize, 0); // biSize
	header.writeInt32LE(size, 4); // biWidth
	header.writeInt32LE(size * 2, 8); // biHeight (XOR + AND)
	header.writeUInt16LE(1, 12); // biPlanes
	header.writeUInt16LE(32, 14); // biBitCount
	header.writeUInt32LE(0, 16); // biCompression = BI_RGB

	const xor = Buffer.alloc(xorSize);
	const center = (size - 1) / 2;
	const radius = size / 2 - 0.5;
	for (let y = 0; y < size; y++) {
		const srcY = size - 1 - y; // bottom-up
		for (let x = 0; x < size; x++) {
			const dx = x - center;
			const dy = srcY - center;
			const inside = dx * dx + dy * dy <= radius * radius;
			const off = (y * size + x) * 4;
			xor.writeUInt8(b, off);
			xor.writeUInt8(g, off + 1);
			xor.writeUInt8(r, off + 2);
			xor.writeUInt8(inside ? 255 : 0, off + 3);
		}
	}

	const and = Buffer.alloc(andSize, 0); // all opaque; alpha handles transparency

	return Buffer.concat([dir, header, xor, and]).toString('base64');
}

export const STATUS_COLORS = {
	connecting: { r: 148, g: 163, b: 184 }, // slate
	connected: { r: 34, g: 197, b: 94 }, // green
	slicing: { r: 56, g: 189, b: 248 }, // sky
	error: { r: 239, g: 68, b: 68 }, // red
	update: { r: 245, g: 158, b: 11 }, // amber
};
