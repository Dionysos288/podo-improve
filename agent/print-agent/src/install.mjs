import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { saveConfig } from './config.mjs';
import { log } from './log.mjs';
import {
	dataDir,
	configPath,
	installedExePath,
	currentExePath,
	isPackaged,
	TASK_NAME,
} from './paths.mjs';

function currentUserId() {
	const domain = process.env.USERDOMAIN;
	const user = process.env.USERNAME;
	if (domain && user) return `${domain}\\${user}`;
	return user || '';
}

function launcherVbsPath() {
	return path.join(dataDir(), 'launch-hidden.vbs');
}

function writeHiddenLauncher(exe) {
	const vbs = [
		'Set shell = CreateObject("WScript.Shell")',
		`shell.Run """${exe}""", 0, False`,
		'',
	].join('\r\n');
	fs.writeFileSync(launcherVbsPath(), vbs, 'utf8');
}

function taskXml(userId) {
	const wscript = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
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
    <Hidden>true</Hidden>
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
      <Command>${wscript}</Command>
      <Arguments>"${launcherVbsPath()}"</Arguments>
    </Exec>
  </Actions>
</Task>`;
}

function runSchtasks(args) {
	const res = spawnSync('schtasks', args, { encoding: 'utf8', windowsHide: true });
	if (res.error) throw res.error;
	return res;
}

/** Register (or refresh) the auto-start task and start the agent now. */
export function install({ url, token, prusaSlicerPath }) {
	if (!url || !token) throw new Error('install requires --url and --token');

	fs.mkdirSync(dataDir(), { recursive: true });

	// Ensure the agent binary lives in the data dir (stable target for updates).
	let exe = installedExePath();
	if (isPackaged()) {
		const src = currentExePath();
		if (path.resolve(src).toLowerCase() !== path.resolve(exe).toLowerCase()) {
			fs.copyFileSync(src, exe);
		}
	} else {
		log.warn('Running unpackaged: writing config but the task will not have a real .exe to launch.');
		exe = currentExePath();
	}

	saveConfig({ url, token, ...(prusaSlicerPath ? { prusaSlicerPath } : {}) });
	log.info('Config saved to', configPath());

	if (process.platform !== 'win32') {
		log.warn('Auto-start registration is only implemented for Windows. Config saved; start the agent manually.');
		return;
	}

	writeHiddenLauncher(exe);

	const xmlPath = path.join(dataDir(), 'task.xml');
	fs.writeFileSync(xmlPath, '\uFEFF' + taskXml(currentUserId()), 'utf16le');

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
}

/** Remove the auto-start task and stored config. */
export function uninstall() {
	if (process.platform === 'win32') {
		runSchtasks(['/End', '/TN', TASK_NAME]);
		const del = runSchtasks(['/Delete', '/TN', TASK_NAME, '/F']);
		if (del.status === 0) log.info('Auto-start task removed.');
		else log.warn('No auto-start task to remove (or removal failed).');
	}
	try {
		fs.rmSync(configPath(), { force: true });
		fs.rmSync(launcherVbsPath(), { force: true });
		log.info('Config removed.');
	} catch (err) {
		log.warn('Failed to remove config:', err.message);
	}
}
