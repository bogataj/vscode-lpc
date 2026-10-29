import * as path from 'path';
import { runExtensionTests } from './vscodeTestHost';

async function main(): Promise<void> {
    const root = path.resolve(__dirname, '../..');
    const filter = process.argv.slice(2).join(' ').trim();

    try {
        const exitCode = await runExtensionTests({
            extensionDevelopmentPath: root,
            extensionTestsPath: path.resolve(__dirname, './suite/index'),
            cacheDirectory: path.join(root, '.vscode-test'),
            version: process.env.VSCODE_TEST_VERSION || 'stable',
            env: filter ? { LPC_TEST_FILTER: filter } : undefined,
            launchArgs: ['--disable-extensions']
        });
        console.log(`Exit code: ${exitCode}`);
        process.exitCode = exitCode;
    } catch (error) {
        console.error('Extension tests failed:', error);
        process.exitCode = 1;
    }
}

void main();
