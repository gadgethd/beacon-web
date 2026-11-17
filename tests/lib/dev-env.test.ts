import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let directory: string;
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
it('reads the explicitly selected DEV environment through the real Vite loader', () => {
  directory = mkdtempSync(join(tmpdir(), 'beacon-dev-env-'));
  writeFileSync(join(directory, '.env'), 'VITE_DEV_PROXY=http://isolated.example:8080\n');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { loadConfigFromFile } from 'vite';
    const { config } = await loadConfigFromFile({ mode: 'development', command: 'serve' });
    process.stdout.write(JSON.stringify({ envDir: config.envDir, target: config.server.proxy['/api'].target }));
  `], { encoding: 'utf8', env: { ...process.env, BEACON_DEV_ENV_DIR: directory, VITE_DEV_PROXY: undefined } });
  expect(JSON.parse(output)).toEqual({ envDir: directory, target: 'http://isolated.example:8080' });
});
