import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.EXPO_REMOTE_PORT || 8082);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use a port from 1 to 65535.');
const environment = { ...process.env };
const defaultSdk = process.platform === 'darwin' ? path.join(homedir(), 'Library/Android/sdk')
  : process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || homedir(), 'Android/Sdk')
  : path.join(homedir(), 'Android/Sdk');
const sdk = environment.ANDROID_HOME || environment.ANDROID_SDK_ROOT || defaultSdk;
let temporary;

// Remote Expo Go does not need ADB. Expo's tunnel setup otherwise mistakes an
// incomplete SDK directory for an installed ADB and exits before connecting.
if (existsSync(sdk) && !existsSync(path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'))) {
  temporary = mkdtempSync(path.join(tmpdir(), 'immigration-eagle-expo-'));
  environment.ANDROID_HOME = path.join(temporary, 'sdk-not-installed');
  console.log('Skipping the incomplete local Android SDK for this remote Expo Go session.');
}

const child = spawn(process.execPath, [path.join(root, 'node_modules/expo/bin/cli'), 'start', '--go', '--tunnel', '--port', String(port)], {
  cwd: root, env: environment, stdio: 'inherit',
});
function cleanup() { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
child.once('error', error => { cleanup(); console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => { cleanup(); process.exitCode = code ?? (signal === 'SIGINT' ? 0 : 1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (!child.killed) child.kill(signal); });
