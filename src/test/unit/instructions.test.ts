import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as path from 'path';
import { test } from 'node:test';

// Each coding agent reads a different file: Codex and others read AGENTS.md, GitHub
// Copilot reads .github/copilot-instructions.md, and Claude Code reads CLAUDE.md.
// AGENTS.md is the source; these tests keep the other two pointing at the same text.

const repositoryRoot = path.resolve(__dirname, '../../..');

async function read(...segments: string[]): Promise<string> {
    const content = await fs.readFile(path.join(repositoryRoot, ...segments), 'utf8');
    return content.replace(/\r\n/g, '\n');
}

test('every agent reads the same instructions', async () => {
    const instructions = await read('AGENTS.md');
    assert.strictEqual(
        await read('.github', 'copilot-instructions.md'),
        instructions,
        'Run "npm run sync:instructions" after editing AGENTS.md.'
    );
    assert.match(await read('CLAUDE.md'), /^@AGENTS\.md$/m, 'CLAUDE.md must import AGENTS.md.');
});

test('the instructions cover testing and releasing with commands that exist', async () => {
    const instructions = await read('AGENTS.md');
    for (const heading of ['## Testing', '## Changes and pull requests', '## Releasing']) {
        assert.ok(instructions.includes(`\n${heading}\n`), `AGENTS.md needs a "${heading}" section.`);
    }

    const { scripts } = JSON.parse(await read('package.json')) as { scripts: Record<string, string> };
    const mentioned = [...instructions.matchAll(/npm run ([\w:-]+)/g)].map(match => match[1]);
    assert.ok(mentioned.length > 0);
    for (const script of new Set(mentioned)) {
        assert.ok(script in scripts, `AGENTS.md mentions "npm run ${script}", which package.json does not define.`);
    }

    for (const workflow of [...instructions.matchAll(/\b([\w-]+\.yml)\b/g)].map(match => match[1])) {
        await fs.access(path.join(repositoryRoot, '.github', 'workflows', workflow));
    }
});
