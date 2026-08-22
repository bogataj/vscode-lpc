import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
    const extensionDevelopmentPath = path.resolve(__dirname, '../..');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    const filter = process.argv.slice(2).join(' ').trim();

    try {
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            extensionTestsEnv: filter ? { LPC_TEST_FILTER: filter } : undefined,
            launchArgs: ['--disable-extensions']
        });
    } catch (error) {
        console.error('Extension tests failed:', error);
        process.exitCode = 1;
    }
}

void main();
