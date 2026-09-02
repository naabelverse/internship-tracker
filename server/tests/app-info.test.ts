import { readFileSync } from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '@/config/app-info';

describe('app info', () => {
  it('reports the same version as server/package.json', () => {
    const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
    const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };

    expect(APP_VERSION).toBe(version);
  });
});
