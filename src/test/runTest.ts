import { promises as fs } from 'fs';
import * as path from 'path';
import { runExtensionTests } from './vscodeTestHost';

async function main(): Promise<void> {
    const root = path.resolve(__dirname, '../..');
    const filter = process.argv.slice(2).join(' ').trim();
    const cacheDirectory = path.join(root, '.vscode-test');
    // A fresh, empty folder so workspace-level settings written by tests never leak between runs.
    const workspaceFolder = path.join(cacheDirectory, 'workspace');

    try {
        await fs.rm(workspaceFolder, { recursive: true, force: true });
        await fs.mkdir(workspaceFolder, { recursive: true });
        const exitCode = await runExtensionTests({
            extensionDevelopmentPath: root,
            extensionTestsPath: path.resolve(__dirname, './suite/index'),
            cacheDirectory,
            version: process.env.VSCODE_TEST_VERSION || 'stable',
            env: filter ? { LPC_TEST_FILTER: filter } : undefined,
            launchArgs: [workspaceFolder, '--disable-extensions']
        });
        console.log(`Exit code: ${exitCode}`);
        process.exitCode = exitCode;
    } catch (error) {
        console.error('Extension tests failed:', error);
        process.exitCode = 1;
    }
}

void main();
