const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'resources', 'keylistener');
fs.mkdirSync(out, { recursive: true });
let result;
if (process.platform === 'win32') {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const found = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' });
  const installation = found.stdout?.trim();
  if (found.status !== 0 || !installation) throw new Error('Visual Studio C++ Build Tools not found');
  const vcvars = path.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  const command = `call "${vcvars}" >nul && cl.exe /nologo /EHsc /std:c++17 /W4 /utf-8 /Fe:"${path.join(out,'keylistener-win32.exe')}" /Fo:"${path.join(out,'keylistener-win32.obj')}" "${path.join(root,'native','win32','keylistener.cpp')}" user32.lib`;
  result = spawnSync('cmd.exe', ['/d', '/c', command], { cwd: root, stdio: 'inherit', windowsVerbatimArguments: true });
} else if (process.platform === 'darwin') {
  result = spawnSync('xcrun', ['clang++', '-std=c++17', '-fblocks', '-arch', 'x86_64', '-arch', 'arm64', '-framework', 'Foundation', '-framework', 'ApplicationServices', '-framework', 'IOKit', path.join(root,'native','darwin','keylistener.mm'), '-o', path.join(out,'keylistener-darwin')], { cwd: root, stdio: 'inherit' });
} else throw new Error('Supported build platforms are Windows and macOS');
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
