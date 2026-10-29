import * as assert from 'assert';
import { test } from 'node:test';
import { LPCFormatOptions, LPCFormatter } from '../../formatter';
import { loadFormatterFixtures } from '../fixtures';

// Runs the formatter core in plain Node, without VS Code, so the fixture
// corpus gives feedback in milliseconds. The Extension Host suite still runs
// the same fixtures through the editor provider.

const options: LPCFormatOptions = { insertSpaces: true, tabSize: 4 };

function format(code: string): string {
    const formatted = new LPCFormatter().format(code, options, 4);
    return formatted.endsWith('\n') ? formatted : `${formatted}\n`;
}

test('formatter fixtures', async context => {
    for (const { name, input, expected } of await loadFormatterFixtures()) {
        await context.test(name, () => {
            const formatted = format(input);
            assert.strictEqual(formatted, expected, `${name}: output did not match the expected file.`);
            assert.strictEqual(format(formatted), formatted, `${name}: a second pass changed the output.`);
        });
    }
});

test('formatting time stays linear in the number of #if blocks', () => {
    const block = (index: number) => [
        `int handler_${index}(int value) {`,
        `#ifdef FLAG_${index}`,
        'if (value) {',
        'record(value);',
        '}',
        '#endif',
        'return value;',
        '}'
    ].join('\n');
    const code = Array.from({ length: 2000 }, (_unused, index) => block(index)).join('\n');

    const started = process.hrtime.bigint();
    format(code);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    // Quadratic analysis needed several seconds for this input; linear takes a fraction of one.
    assert.ok(elapsedMs < 3000, `Formatting 2,000 #ifdef blocks took ${elapsedMs.toFixed(0)} ms.`);
});
