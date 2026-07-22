const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(
  __dirname,
  '..',
  '..',
  'node_modules',
  'app-builder-lib',
  'templates',
  'nsis',
  'include',
  'installUtil.nsh',
);

const original = `    \${if} $R5 > 5
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY OneMoreAttempt
      Return
    \${endIf}`;

const patched = `    \${if} $R5 > 5
      !ifmacrodef customUninstallRetryExhausted
        !insertmacro customUninstallRetryExhausted
        \${if} $R0 == 0
          Return
        \${endIf}
      !endif
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY OneMoreAttempt
      Return
    \${endIf}`;

const source = fs.readFileSync(target, 'utf8');
if (source.includes(patched)) {
  process.stdout.write('[patch-electron-builder-nsis] already applied\n');
} else if (source.includes(original)) {
  fs.writeFileSync(target, source.replace(original, patched));
  process.stdout.write('[patch-electron-builder-nsis] applied\n');
} else {
  throw new Error('Unsupported app-builder-lib installUtil.nsh: retry hook anchor was not found');
}
