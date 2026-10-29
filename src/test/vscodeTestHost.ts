import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { createWriteStream, existsSync, promises as fs } from 'fs';
import * as path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream } from 'stream/web';

// Dependency-free replacement for @vscode/test-electron: resolves a VS Code
// build from the official update service, verifies its SHA-256, extracts it
// with the platform's archive tool, and launches the extension tests.

export interface ExtensionTestOptions {
    extensionDevelopmentPath: string;
    extensionTestsPath: string;
    cacheDirectory: string;
    version?: string;
    launchArgs?: string[];
    env?: Record<string, string>;
}

interface ReleaseInfo {
    url: string;
    productVersion: string;
    sha256hash: string;
}

const updateServer = 'https://update.code.visualstudio.com';
const completeMarker = 'is-complete';

function platformId(): string {
    const isArm64 = process.arch === 'arm64';
    switch (process.platform) {
        case 'win32':
            return isArm64 ? 'win32-arm64-archive' : 'win32-x64-archive';
        case 'darwin':
            return isArm64 ? 'darwin-arm64' : 'darwin';
        case 'linux':
            return isArm64 ? 'linux-arm64' : 'linux-x64';
        default:
            throw new Error(`VS Code tests are not supported on ${process.platform}.`);
    }
}

function executablePath(installDirectory: string): string {
    switch (process.platform) {
        case 'win32':
            return path.join(installDirectory, 'Code.exe');
        case 'darwin':
            return path.join(installDirectory, 'Visual Studio Code.app', 'Contents', 'MacOS', 'Electron');
        default:
            return path.join(installDirectory, 'code');
    }
}

function compareVersions(left: string, right: string): number {
    const leftParts = left.split('.').map(Number);
    const rightParts = right.split('.').map(Number);
    for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
        const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
        if (difference !== 0) {
            return difference;
        }
    }
    return 0;
}

async function fetchRelease(platform: string, version: string): Promise<ReleaseInfo> {
    const metadataUrl = version === 'stable'
        ? `${updateServer}/api/update/${platform}/stable/latest`
        : `${updateServer}/api/versions/${encodeURIComponent(version)}/${platform}/stable`;
    const response = await fetch(metadataUrl);
    if (!response.ok) {
        throw new Error(`Could not resolve VS Code ${version} for ${platform}: HTTP ${response.status}.`);
    }

    const release = await response.json() as Partial<ReleaseInfo>;
    if (typeof release.url !== 'string'
        || new URL(release.url).protocol !== 'https:'
        || typeof release.productVersion !== 'string'
        || !/^\d+\.\d+\.\d+$/.test(release.productVersion)
        || typeof release.sha256hash !== 'string'
        || !/^[0-9a-f]{64}$/.test(release.sha256hash)) {
        throw new Error(`Unexpected VS Code release metadata from ${metadataUrl}.`);
    }
    return release as ReleaseInfo;
}

async function findCachedInstall(cacheDirectory: string, platform: string): Promise<string | undefined> {
    const prefix = `vscode-${platform}-`;
    const entries = await fs.readdir(cacheDirectory, { withFileTypes: true }).catch(() => []);
    const versions = entries
        .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
        .map(entry => entry.name.slice(prefix.length))
        .filter(version => /^\d+\.\d+\.\d+$/.test(version)
            && existsSync(path.join(cacheDirectory, `${prefix}${version}`, completeMarker)))
        .sort(compareVersions);
    const newest = versions[versions.length - 1];
    return newest ? path.join(cacheDirectory, `${prefix}${newest}`) : undefined;
}

async function downloadArchive(release: ReleaseInfo, archivePath: string): Promise<void> {
    const response = await fetch(release.url);
    if (!response.ok || !response.body) {
        throw new Error(`Could not download ${release.url}: HTTP ${response.status}.`);
    }

    const hash = createHash('sha256');
    const hasher = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            hash.update(chunk);
            callback(null, chunk);
        }
    });
    await pipeline(
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
        hasher,
        createWriteStream(archivePath)
    );

    const digest = hash.digest('hex');
    if (digest !== release.sha256hash) {
        throw new Error(`Checksum mismatch for ${release.url}: expected ${release.sha256hash}, got ${digest}.`);
    }
}

function runProcess(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<number> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { env, stdio: 'inherit' });
        child.on('error', reject);
        child.on('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
}

async function extractArchive(archivePath: string, installDirectory: string): Promise<void> {
    await fs.mkdir(installDirectory, { recursive: true });
    let exitCode: number;
    if (process.platform === 'win32') {
        // The bsdtar shipped with Windows extracts zip archives; a GNU tar earlier on PATH would not.
        const systemTar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
        exitCode = await runProcess(systemTar, ['-xf', archivePath, '-C', installDirectory]);
    } else if (process.platform === 'darwin') {
        exitCode = await runProcess('unzip', ['-q', archivePath, '-d', installDirectory]);
    } else {
        exitCode = await runProcess('tar', ['-xzf', archivePath, '-C', installDirectory, '--strip-components=1']);
    }
    if (exitCode !== 0) {
        throw new Error(`Extracting ${archivePath} failed with exit code ${exitCode}.`);
    }
}

async function resolveInstall(cacheDirectory: string, version: string): Promise<string> {
    const platform = platformId();
    await fs.mkdir(cacheDirectory, { recursive: true });

    let release: ReleaseInfo;
    try {
        release = await fetchRelease(platform, version);
    } catch (error) {
        const cached = version === 'stable' ? await findCachedInstall(cacheDirectory, platform) : undefined;
        if (!cached) {
            throw error;
        }
        console.warn(`Using cached ${path.basename(cached)}: ${error instanceof Error ? error.message : error}`);
        return cached;
    }

    const installDirectory = path.join(cacheDirectory, `vscode-${platform}-${release.productVersion}`);
    if (existsSync(path.join(installDirectory, completeMarker))) {
        return installDirectory;
    }

    console.log(`Downloading VS Code ${release.productVersion} (${platform})...`);
    const archivePath = path.join(cacheDirectory, `${path.basename(installDirectory)}${path.extname(new URL(release.url).pathname)}`);
    await fs.rm(installDirectory, { recursive: true, force: true });
    try {
        await downloadArchive(release, archivePath);
        await extractArchive(archivePath, installDirectory);
    } finally {
        await fs.rm(archivePath, { force: true });
    }
    await fs.writeFile(path.join(installDirectory, completeMarker), '');
    return installDirectory;
}

export async function runExtensionTests(options: ExtensionTestOptions): Promise<number> {
    const installDirectory = await resolveInstall(options.cacheDirectory, options.version ?? 'stable');
    const args = [
        ...(options.launchArgs ?? []),
        '--no-sandbox',
        '--disable-gpu-sandbox',
        '--disable-updates',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-workspace-trust',
        `--extensionTestsPath=${options.extensionTestsPath}`,
        `--extensionDevelopmentPath=${options.extensionDevelopmentPath}`,
        `--extensions-dir=${path.join(options.cacheDirectory, 'extensions')}`,
        `--user-data-dir=${path.join(options.cacheDirectory, 'user-data')}`
    ];
    return runProcess(executablePath(installDirectory), args, { ...process.env, ...options.env });
}
