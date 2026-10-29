// @ts-check
// Dependency-free VSIX packager. Builds the same package layout and manifest
// as `vsce package` for this extension from an explicit file allowlist, so
// packaging and CI never install the vsce dependency tree.
//
// Usage: node scripts/package-vsix.mjs [--out <file.vsix>]

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

function fail(message) {
    console.error(`package-vsix: ${message}`);
    process.exit(1);
}

function requireString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        fail(`package.json must define "${field}".`);
    }
    return value;
}

function requireFile(relativePath) {
    const absolutePath = path.join(root, relativePath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
        fail(`Missing file "${relativePath}". Run "npm run compile" first if it is build output.`);
    }
    return relativePath.split(path.sep).join('/');
}

function listJavaScript(relativeDirectory) {
    const files = [];
    for (const entry of readdirSync(path.join(root, relativeDirectory), { withFileTypes: true })) {
        const relativePath = path.posix.join(relativeDirectory, entry.name);
        if (entry.isDirectory()) {
            // Compiled tests are never shipped.
            if (relativePath !== 'out/test') {
                files.push(...listJavaScript(relativePath));
            }
        } else if (entry.name.endsWith('.js')) {
            files.push(relativePath);
        }
    }
    return files;
}

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function normalizeRepositoryUrl(repository) {
    const url = typeof repository === 'string' ? repository : repository?.url;
    if (typeof url !== 'string') {
        return undefined;
    }
    return url.endsWith('.git') ? url : `${url}.git`;
}

const name = requireString(manifest.name, 'name');
const publisher = requireString(manifest.publisher, 'publisher');
const version = requireString(manifest.version, 'version');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fail(`Version "${version}" must be MAJOR.MINOR.PATCH.`);
}
const engine = requireString(manifest.engines?.vscode, 'engines.vscode');
const main = requireFile(path.normalize(`${requireString(manifest.main, 'main')}`));

const outIndex = process.argv.indexOf('--out');
const outFile = path.resolve(root, outIndex >= 0 && process.argv[outIndex + 1]
    ? process.argv[outIndex + 1]
    : `${name}-${version}.vsix`);

// Packaged files: [source path, path inside the VSIX].
const contributes = manifest.contributes ?? {};
const extensionFiles = new Map([
    ['package.json', 'extension/package.json'],
    [requireFile('README.md'), 'extension/readme.md'],
    [requireFile('CHANGELOG.md'), 'extension/changelog.md'],
    [requireFile('LICENSE'), 'extension/LICENSE.txt']
]);
const referencedFiles = [
    main,
    ...listJavaScript('out'),
    ...(contributes.languages ?? []).map(language => language.configuration).filter(Boolean),
    ...(contributes.grammars ?? []).map(grammar => grammar.path)
];
for (const reference of referencedFiles) {
    const source = requireFile(path.normalize(reference));
    extensionFiles.set(source, `extension/${source}`);
}

const languages = contributes.languages ?? [];
const tags = [...new Set([
    ...(manifest.keywords ?? []),
    ...languages.map(language => language.id),
    ...languages.flatMap(language => language.aliases ?? []),
    ...languages.flatMap(language => language.extensions ?? []).map(extension => `__ext_${extension.replace(/^\./, '')}`)
])];
const repositoryUrl = normalizeRepositoryUrl(manifest.repository);
const links = [
    ['Source', repositoryUrl],
    ['Getstarted', repositoryUrl],
    ['GitHub', repositoryUrl],
    ['Support', typeof manifest.bugs === 'string' ? manifest.bugs : manifest.bugs?.url],
    ['Learn', manifest.homepage]
].filter(([, url]) => typeof url === 'string');

const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
	<Metadata>
		<Identity Language="en-US" Id="${escapeXml(name)}" Version="${escapeXml(version)}" Publisher="${escapeXml(publisher)}" />
		<DisplayName>${escapeXml(manifest.displayName ?? name)}</DisplayName>
		<Description xml:space="preserve">${escapeXml(manifest.description ?? '')}</Description>
		<Tags>${escapeXml(tags.join(','))}</Tags>
		<Categories>${escapeXml((manifest.categories ?? []).join(','))}</Categories>
		<GalleryFlags>Public</GalleryFlags>
		<Properties>
			<Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(engine)}" />
			<Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="${escapeXml((manifest.extensionDependencies ?? []).join(','))}" />
			<Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="${escapeXml((manifest.extensionPack ?? []).join(','))}" />
			<Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
			<Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
			<Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value="" />
			<Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
${links.map(([kind, url]) => `			<Property Id="Microsoft.VisualStudio.Services.Links.${kind}" Value="${escapeXml(url)}" />`).join('\n')}
			<Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
			<Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
		</Properties>
		<License>extension/LICENSE.txt</License>
	</Metadata>
	<Installation>
		<InstallationTarget Id="Microsoft.VisualStudio.Code" />
	</Installation>
	<Dependencies />
	<Assets>
		<Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
		<Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/readme.md" Addressable="true" />
		<Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/changelog.md" Addressable="true" />
		<Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
	</Assets>
</PackageManifest>
`;

const contentTypes = new Map([
    ['.js', 'application/javascript'],
    ['.json', 'application/json'],
    ['.md', 'text/markdown'],
    ['.txt', 'text/plain'],
    ['.vsixmanifest', 'text/xml']
]);
const packagedExtensions = [...new Set([...extensionFiles.values(), 'extension.vsixmanifest'].map(file => path.posix.extname(file)))];
for (const extension of packagedExtensions) {
    if (!contentTypes.has(extension)) {
        fail(`No content type is defined for "${extension}" files.`);
    }
}
const contentTypesXml = '<?xml version="1.0" encoding="utf-8"?>\n'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + packagedExtensions.sort().map(extension =>
        `<Default Extension="${extension}" ContentType="${contentTypes.get(extension)}"/>`).join('')
    + '</Types>';

/** @type {Array<[string, Buffer]>} */
const entries = [
    ['extension.vsixmanifest', Buffer.from(vsixManifest, 'utf8')],
    ['[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8')],
    ...[...extensionFiles].map(([source, target]) => /** @type {[string, Buffer]} */ (
        [target, readFileSync(path.join(root, source))]
    ))
];

// Minimal ZIP writer (deflate, UTF-8 names, fixed 1980-01-01 timestamps for reproducible output).
const dosTime = 0;
const dosDate = (0 << 9) | (1 << 5) | 1;
const localParts = [];
const centralParts = [];
let offset = 0;
for (const [entryName, data] of entries) {
    const nameBuffer = Buffer.from(entryName, 'utf8');
    const compressed = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + compressed.length;
}

const centralDirectory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(offset, 16);

writeFileSync(outFile, Buffer.concat([...localParts, centralDirectory, end]));
console.log(`Packaged ${path.relative(root, outFile)} (${entries.length} files)`);
for (const [entryName, data] of entries) {
    console.log(`  ${entryName} (${data.length} bytes)`);
}
