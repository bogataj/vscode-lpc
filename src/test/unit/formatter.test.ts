import * as assert from 'assert';
import { test } from 'node:test';
import { mapFormattedLineRange } from '../../formatRange';
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

function withoutWhitespace(code: string): string {
    return code.replace(/\s+/g, '');
}

test('formatter fixtures', async context => {
    for (const { name, input, expected } of await loadFormatterFixtures()) {
        await context.test(name, () => {
            const formatted = format(input);
            assert.strictEqual(formatted, expected, `${name}: output did not match the expected file.`);
            assert.strictEqual(format(formatted), formatted, `${name}: a second pass changed the output.`);
            assert.strictEqual(
                withoutWhitespace(formatted),
                withoutWhitespace(input),
                `${name}: formatting changed more than whitespace.`
            );
        });
    }
});

test('block comments keep their text and relative indentation with tabs', () => {
    const input = [
        'void describe() {',
        '/* Example:',
        '       call();',
        '* starred',
        '*/',
        'call();',
        'next();',
        '}'
    ].join('\n');
    const formatted = new LPCFormatter().format(input, { insertSpaces: false, tabSize: 4 }, 4);
    assert.strictEqual(formatted, [
        'void describe() {',
        '\t/* Example:',
        '\t       call();',
        '\t * starred',
        '\t */',
        '\tcall();',
        '\tnext();',
        '}'
    ].join('\n'));
    assert.strictEqual(new LPCFormatter().format(formatted, { insertSpaces: false, tabSize: 4 }, 4), formatted);
});

test('aligned continuation lines use tabs for indentation and spaces for alignment', () => {
    const tabs: LPCFormatOptions = { insertSpaces: false, tabSize: 8 };
    const input = [
        'void describe() {',
        'text = "first " +',
        '"second";',
        'value = ready ? "yes"',
        ': "no";',
        'int count;    // note',
        '}'
    ].join('\n');
    const formatted = new LPCFormatter().format(input, tabs, 4);
    assert.strictEqual(formatted, [
        'void describe() {',
        '\ttext = "first " +',
        '\t       "second";',
        '\tvalue = ready ? "yes"',
        '\t              : "no";',
        '\tint count;    // note',
        '}'
    ].join('\n'));
    assert.strictEqual(new LPCFormatter().format(formatted, tabs, 4), formatted);
});

test('a formatted line range maps back to the lines it came from', () => {
    const original = ['void f() {', 'x=1;', '', 'y=2;', '}'];
    const formatted = ['void f() {', '    x = 1;', '', '    y = 2;', '}'];

    assert.deepStrictEqual(mapFormattedLineRange(original, formatted, 1, 1), {
        startLine: 1, endLine: 1, formattedStartLine: 1, formattedEndLine: 1, exact: true
    });
    // Blank lines at the ends of the selection are left alone.
    assert.deepStrictEqual(mapFormattedLineRange(original, formatted, 2, 3), {
        startLine: 3, endLine: 3, formattedStartLine: 3, formattedEndLine: 3, exact: true
    });
    assert.strictEqual(mapFormattedLineRange(original, formatted, 2, 2), undefined);
});

test('a line range grows when formatting joins lines across its boundary', () => {
    const original = ['int before;', 'int get()', '{', 'return 1;', '}', 'int after;'];
    const formatted = ['int before;', 'int get() { return 1; }', 'int after;'];

    assert.deepStrictEqual(mapFormattedLineRange(original, formatted, 3, 3), {
        startLine: 1, endLine: 4, formattedStartLine: 1, formattedEndLine: 1, exact: false
    });
    assert.deepStrictEqual(mapFormattedLineRange(original, formatted, 0, 5), {
        startLine: 0, endLine: 5, formattedStartLine: 0, formattedEndLine: 2, exact: true
    });
});

test('a line range is not mapped when the texts differ in more than whitespace', () => {
    assert.strictEqual(mapFormattedLineRange(['x=1;'], ['x = 2;'], 0, 0), undefined);
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
