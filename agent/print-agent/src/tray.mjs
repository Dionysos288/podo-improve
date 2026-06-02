import { log } from './log.mjs';
import { buildStatusIcoBase64, STATUS_COLORS } from './ico.mjs';

const STATUS_LABELS = {
	connecting: 'Verbinden…',
	connected: 'Verbonden',
	slicing: 'Bezig met slicen…',
	error: 'Fout — zie log',
	update: 'Update wordt geïnstalleerd…',
};

const NOOP_TRAY = {
	setStatus() {},
	destroy() {},
};

function buildMenu(status, detail) {
	return {
		icon: buildStatusIcoBase64(STATUS_COLORS[status] ?? STATUS_COLORS.connecting),
		title: 'Podo Print Agent',
		tooltip: detail ? `Podo Print Agent — ${detail}` : `Podo Print Agent — ${STATUS_LABELS[status] ?? status}`,
		items: [
			{ title: STATUS_LABELS[status] ?? status, enabled: false },
			{ title: 'Logbestand openen', enabled: true },
			{ title: 'Afsluiten', enabled: true },
		],
	};
}

/**
 * Create a best-effort system tray indicator. Tray failures never block the
 * agent — on any error this returns a no-op controller.
 *
 * @returns {Promise<{ setStatus(status:string, detail?:string):void, destroy():void }>}
 */
export async function createTray({ onOpenLog, onQuit } = {}) {
	if (process.platform !== 'win32') return NOOP_TRAY;

	let SysTray;
	try {
		const mod = await import('systray2');
		SysTray = mod.default ?? mod;
	} catch (err) {
		log.warn('tray: systray2 unavailable, running headless', err.message);
		return NOOP_TRAY;
	}

	try {
		let current = 'connecting';
		const systray = new SysTray({
			menu: buildMenu(current, null),
			debug: false,
			copyDir: true, // extract helper binary so it works inside a packaged exe
		});

		systray.onClick((action) => {
			const title = action?.item?.title;
			if (title === 'Logbestand openen') {
				onOpenLog?.();
			} else if (title === 'Afsluiten') {
				try {
					systray.kill(false);
				} catch {
					// ignore
				}
				onQuit?.();
			}
		});

		await systray.ready();

		return {
			setStatus(status, detail) {
				if (status === current && !detail) return;
				current = status;
				try {
					systray.sendAction({ type: 'update-menu', menu: buildMenu(status, detail) });
				} catch (err) {
					log.warn('tray: failed to update status', err.message);
				}
			},
			destroy() {
				try {
					systray.kill(false);
				} catch {
					// ignore
				}
			},
		};
	} catch (err) {
		log.warn('tray: failed to start, running headless', err.message);
		return NOOP_TRAY;
	}
}
