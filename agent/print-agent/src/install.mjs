import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { loadConfig, saveConfig } from './config.mjs';
import { log } from './log.mjs';
import {
	dataDir,
	configPath,
	installedExePath,
	currentExePath,
	isPackaged,
	TASK_NAME,
	startMenuShortcutPath,
} from './paths.mjs';

function currentUserId() {
	const domain = process.env.USERDOMAIN;
	const user = process.env.USERNAME;
	if (domain && user) return `${domain}\\${user}`;
	return user || '';
}

function taskXml(userId, exe) {
	// Run the exe directly (not via hidden wscript) so the tray icon can appear.
	return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Podo Improve Print Agent - local PrusaSlicer slicing.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      ${userId ? `<UserId>${userId}</UserId>` : ''}
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      ${userId ? `<UserId>${userId}</UserId>` : ''}
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>99</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${exe.replace(/\\/g, '\\\\')}</Command>
      <WorkingDirectory>${dataDir().replace(/\\/g, '\\\\')}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;
}

function runSchtasks(args) {
	const res = spawnSync('schtasks', args, { encoding: 'utf8', windowsHide: true });
	if (res.error) throw res.error;
	return res;
}

function createStartMenuShortcut(exe) {
	const shortcut = startMenuShortcutPath();
	fs.mkdirSync(path.dirname(shortcut), { recursive: true });
	const ps = [
		'$WshShell = New-Object -ComObject WScript.Shell',
		`$Shortcut = $WshShell.CreateShortcut('${shortcut.replace(/'/g, "''")}')`,
		`$Shortcut.TargetPath = '${exe.replace(/'/g, "''")}'`,
		`$Shortcut.WorkingDirectory = '${dataDir().replace(/'/g, "''")}'`,
		'$Shortcut.WindowStyle = 7',
		'$Shortcut.Description = "Podo Improve Print Agent - lokale slicer"',
		'$Shortcut.Save()',
	].join('; ');
	const res = spawnSync(
		'powershell',
		['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
		{ encoding: 'utf8', windowsHide: true }
	);
	if (res.status !== 0) {
		log.warn('Could not create Start Menu shortcut:', (res.stderr || res.stdout || '').trim());
		return;
	}
	log.info('Start Menu shortcut created:', shortcut);
}

function removeStartMenuShortcut() {
	try {
		fs.rmSync(startMenuShortcutPath(), { force: true });
	} catch {
		// ignore
	}
}

function resolveInstallExe() {
	let exe = installedExePath();
	if (isPackaged()) {
		const src = currentExePath();
		if (path.resolve(src).toLowerCase() !== path.resolve(exe).toLowerCase()) {
			fs.copyFileSync(src, exe);
		}
	} else {
		log.warn('Running unpackaged: task will launch via node (tray may differ from production exe).');
		exe = currentExePath();
	}
	return exe;
}

/** Register (or refresh) the auto-start task and start the agent now. */
export function install({ url, token, prusaSlicerPath }) {
	if (!url || !token) throw new Error('install requires --url and --token');

	fs.mkdirSync(dataDir(), { recursive: true });
	const exe = resolveInstallExe();

	saveConfig({ url, token, ...(prusaSlicerPath ? { prusaSlicerPath } : {}) });
	log.info('Config saved to', configPath());

	if (process.platform !== 'win32') {
		log.warn('Auto-start registration is only implemented for Windows. Config saved; start the agent manually.');
		return { exe, startMenu: null };
	}

	createStartMenuShortcut(exe);

	const xmlPath = path.join(dataDir(), 'task.xml');
	fs.writeFileSync(xmlPath, '\uFEFF' + taskXml(currentUserId(), exe), 'utf16le');

	const create = runSchtasks(['/Create', '/TN', TASK_NAME, '/XML', xmlPath, '/F']);
	if (create.status !== 0) {
		log.error('Failed to register scheduled task:', (create.stderr || create.stdout || '').trim());
		throw new Error('Task Scheduler registration failed. Try running the setup again.');
	}
	log.info('Auto-start task registered:', TASK_NAME);

	const run = runSchtasks(['/Run', '/TN', TASK_NAME]);
	if (run.status !== 0) {
		log.warn('Could not start the task immediately; it will start at next logon.');
	} else {
		log.info('Agent started.');
	}

	return { exe, startMenu: startMenuShortcutPath() };
}

/** Re-run install using saved config (tray: Opnieuw installeren). */
export function reinstallFromConfig() {
	const config = loadConfig();
	if (!config?.url || !config?.token) {
		throw new Error('Agent is not configured. Install from the web app first.');
	}
	return install({
		url: config.url,
		token: config.token,
		prusaSlicerPath: config.prusaSlicerPath,
	});
}

/** Remove the auto-start task and stored config. */
export function uninstall() {
	if (process.platform === 'win32') {
		runSchtasks(['/End', '/TN', TASK_NAME]);
		const del = runSchtasks(['/Delete', '/TN', TASK_NAME, '/F']);
		if (del.status === 0) log.info('Auto-start task removed.');
		else log.warn('No auto-start task to remove (or removal failed).');
		removeStartMenuShortcut();
	}
	try {
		fs.rmSync(configPath(), { force: true });
		log.info('Config removed.');
	} catch (err) {
		log.warn('Failed to remove config:', err.message);
	}
}

/** Spawn a detached reinstall and exit the current process. */
export function scheduleReinstallAndExit(exe) {
	const config = loadConfig();
	if (!config?.url || !config?.token) return;
	const target = fs.existsSync(installedExePath()) ? installedExePath() : exe;
	spawn(
		target,
		['install', '--url', config.url, '--token', config.token],
		{ detached: true, stdio: 'ignore', windowsHide: true }
	).unref();
}
