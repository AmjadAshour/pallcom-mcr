import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const CONFIG_DIR = process.env.MCR_AGENT_CONFIG_DIR || path.join(os.homedir(), '.mcr-agent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'credentials.json');
const windows = process.platform === 'win32';
let cachedFile;
let cachedConfig;
let windowsDirectorySecured = false;

function runWindowsSecurity(script, input) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    return execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
      input, encoding: 'utf8', windowsHide: true, timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 128 * 1024
    }).trim();
  } catch {
    throw new Error('Agent credential storage could not be secured or opened by this Windows account.');
  }
}

function secureWindowsDirectory(directory) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$encoding = [Text.Encoding]::UTF8',
    '$directory = $encoding.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))',
    '$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User',
    "$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')",
    '$acl = [IO.Directory]::GetAccessControl($directory)',
    "if ($acl.GetOwner([Security.Principal.SecurityIdentifier]) -ne $identity) { throw 'Invalid directory owner' }",
    '$acl.SetAccessRuleProtection($true, $false)',
    'foreach ($rule in $acl.Access) { $acl.RemoveAccessRuleSpecific($rule) }',
    'foreach ($sid in @($identity, $system)) {' +
      " $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow');" +
      ' $acl.AddAccessRule($rule) }',
    '[IO.Directory]::SetAccessControl($directory, $acl)',
  ].join('; ');
  runWindowsSecurity(script, Buffer.from(directory).toString('base64'));
}

function windowsProtect(text, decrypt = false) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Security',
    '$payload = [Convert]::FromBase64String([Console]::In.ReadToEnd())',
    '$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser',
    '$result = [Security.Cryptography.ProtectedData]::' + (decrypt ? 'Unprotect' : 'Protect') + '($payload, $null, $scope)',
    '[Console]::Write([Convert]::ToBase64String($result))',
  ].join('; ');
  return runWindowsSecurity(script, text);
}

function checkPath(file, directory) {
  const stat = fs.lstatSync(file);
  if ((directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) ||
    (!windows && stat.uid !== process.getuid())) {
    throw new Error('Agent configuration requires a private path owned by its service account.');
  }
  if (!windows && (stat.mode & 0o777) !== (directory ? 0o700 : 0o600)) {
    fs.chmodSync(file, directory ? 0o700 : 0o600);
  }
}

export class Keystore {
  static getDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
    checkPath(CONFIG_DIR, true);
    if (windows && !windowsDirectorySecured) {
      secureWindowsDirectory(path.resolve(CONFIG_DIR));
      windowsDirectorySecured = true;
    }
    return CONFIG_DIR;
  }

  static saveConfig(config) {
    this.getDir();
    const temporaryFile = path.join(CONFIG_DIR, `credentials-${randomUUID()}.tmp`);
    try {
      const json = JSON.stringify(config);
      const content = windows
        ? JSON.stringify({ dpapi: windowsProtect(Buffer.from(json).toString('base64')) })
        : json;
      fs.writeFileSync(temporaryFile, content, {
        encoding: 'utf-8', mode: 0o600, flag: 'wx'
      });
      fs.renameSync(temporaryFile, CONFIG_FILE);
    } finally {
      fs.rmSync(temporaryFile, { force: true });
    }
  }

  static loadConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
      return null;
    }
    try {
      this.getDir();
      checkPath(CONFIG_FILE, false);
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      if (content !== cachedFile) {
        const stored = JSON.parse(content);
        const config = windows && typeof stored.dpapi === 'string'
          ? JSON.parse(Buffer.from(windowsProtect(stored.dpapi, true), 'base64').toString())
          : stored;
        if (windows && !stored.dpapi) this.saveConfig(config);
        cachedFile = content;
        cachedConfig = config;
      }
      return structuredClone(cachedConfig);
    } catch {
      return null;
    }
  }

  static clear() {
    cachedFile = undefined;
    cachedConfig = undefined;
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  }
}
