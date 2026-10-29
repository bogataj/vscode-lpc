import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { LPCDocumentFormattingEditProvider } from '../../formatProvider';
import { loadFormatterFixtureTests } from './formatterFixtures';
import { formattingOptions, withLpcDocument } from './formatTestUtils';

interface TestCase {
    name: string;
    run: () => Promise<void>;
}

const integrationTests: TestCase[] = [
    {
        name: 'preserves base indentation for range formatting',
        run: async () => {
            const input = [
                'void outer() {',
                '    if (ready) {',
                '    write("ok");',
                '    }',
                '}'
            ].join('\n');

            await withLpcDocument(input, document => {
                const provider = new LPCDocumentFormattingEditProvider();
                const cancellation = new vscode.CancellationTokenSource();
                const range = new vscode.Range(1, 0, 4, 0);
                try {
                    const edits = provider.provideDocumentRangeFormattingEdits(
                        document,
                        range,
                        formattingOptions,
                        cancellation.token
                    );
                    assert.strictEqual(edits.length, 1);
                    assert.strictEqual(edits[0].newText, [
                        '    if (ready) {',
                        '        write("ok");',
                        '    }',
                        ''
                    ].join('\n'));
                } finally {
                    cancellation.dispose();
                }
            });

            const tabIndentedInput = [
                'void outer() {',
                '\tif (ready) {',
                '\twrite("ok");',
                '\t}',
                '}'
            ].join('\n');
            await withLpcDocument(tabIndentedInput, document => {
                const provider = new LPCDocumentFormattingEditProvider();
                const cancellation = new vscode.CancellationTokenSource();
                const range = new vscode.Range(1, 0, 4, 0);
                try {
                    const edits = provider.provideDocumentRangeFormattingEdits(
                        document,
                        range,
                        { insertSpaces: false, tabSize: 8 },
                        cancellation.token
                    );
                    assert.strictEqual(edits.length, 1);
                    assert.strictEqual(edits[0].newText, [
                        '\tif (ready) {',
                        '\t\twrite("ok");',
                        '\t}',
                        ''
                    ].join('\n'));
                } finally {
                    cancellation.dispose();
                }
            });

            const mixedIndentationInput = [
                'void create() {',
                '\tdescribe(',
                '\t\t"first line " +',
                '        "second line " +',
                '\t\t"third line"',
                '\t);',
                '\treturn condition',
                '\t\t? primary',
                '        : secondary;',
                '}'
            ].join('\n');
            await withLpcDocument(mixedIndentationInput, document => {
                const provider = new LPCDocumentFormattingEditProvider();
                const format = (options: vscode.FormattingOptions): string => {
                    const cancellation = new vscode.CancellationTokenSource();
                    try {
                        const edits = provider.provideDocumentFormattingEdits(
                            document,
                            options,
                            cancellation.token
                        );
                        assert.strictEqual(edits.length, 1);
                        return edits[0].newText;
                    } finally {
                        cancellation.dispose();
                    }
                };

                assert.strictEqual(format({ insertSpaces: true, tabSize: 4 }), [
                    'void create() {',
                    '    describe(',
                    '        "first line " +',
                    '        "second line " +',
                    '        "third line"',
                    '    );',
                    '    return condition',
                    '        ? primary',
                    '        : secondary;',
                    '}',
                    ''
                ].join('\n'));

                assert.strictEqual(format({ insertSpaces: false, tabSize: 4 }), [
                    'void create() {',
                    '\tdescribe(',
                    '\t\t"first line " +',
                    '\t\t"second line " +',
                    '\t\t"third line"',
                    '\t);',
                    '\treturn condition',
                    '\t\t? primary',
                    '\t\t: secondary;',
                    '}',
                    ''
                ].join('\n'));
            });

            const partialSelectionInput = [
                'void outer() {',
                '    int value=1;',
                '}'
            ].join('\n');
            await withLpcDocument(partialSelectionInput, document => {
                const provider = new LPCDocumentFormattingEditProvider();
                const cancellation = new vscode.CancellationTokenSource();
                try {
                    const edits = provider.provideDocumentRangeFormattingEdits(
                        document,
                        new vscode.Range(1, 8, 1, 13),
                        formattingOptions,
                        cancellation.token
                    );
                    assert.strictEqual(edits.length, 1);
                    assert.deepStrictEqual(edits[0].range, new vscode.Range(1, 0, 2, 0));
                    assert.strictEqual(edits[0].newText, '    int value = 1;\n');
                } finally {
                    cancellation.dispose();
                }
            });

            const unmatchedCloseInput = [
                'void outer() {',
                '    if (ready) {',
                '        handle();',
                '    }',
                '    else',
                '    fallback();',
                '    if (other)',
                '    next();',
                '}'
            ].join('\n');
            await withLpcDocument(unmatchedCloseInput, document => {
                const provider = new LPCDocumentFormattingEditProvider();
                const cancellation = new vscode.CancellationTokenSource();
                try {
                    const edits = provider.provideDocumentRangeFormattingEdits(
                        document,
                        new vscode.Range(3, 0, 8, 0),
                        formattingOptions,
                        cancellation.token
                    );
                    assert.strictEqual(edits.length, 1);
                    assert.strictEqual(edits[0].newText, [
                        '    }',
                        '    else',
                        '        fallback();',
                        '    if (other)',
                        '        next();',
                        ''
                    ].join('\n'));
                } finally {
                    cancellation.dispose();
                }
            });

            const continuedStringFixture = await fs.readFile(
                path.resolve(
                    __dirname,
                    '../../../src/test/fixtures/formatter/continued-string-content.expected.lpc'
                ),
                'utf8'
            );
            await withLpcDocument(continuedStringFixture, document => {
                const provider = new LPCDocumentFormattingEditProvider();
                const cancellation = new vscode.CancellationTokenSource();
                try {
                    const edits = provider.provideDocumentRangeFormattingEdits(
                        document,
                        new vscode.Range(2, 0, 3, 0),
                        formattingOptions,
                        cancellation.token
                    );
                    assert.deepStrictEqual(edits, []);
                } finally {
                    cancellation.dispose();
                }
            });

            const preprocessorRangeFixture = await fs.readFile(
                path.resolve(
                    __dirname,
                    '../../../src/test/fixtures/formatter/range-preprocessor-context.expected.lpc'
                ),
                'utf8'
            ).then(content => content.replace(/\r\n?/g, '\n'));
            await withLpcDocument(preprocessorRangeFixture, document => {
                const provider = new LPCDocumentFormattingEditProvider();
                const cancellation = new vscode.CancellationTokenSource();
                try {
                    const edits = provider.provideDocumentRangeFormattingEdits(
                        document,
                        new vscode.Range(1, 0, 8, 0),
                        formattingOptions,
                        cancellation.token
                    );
                    assert.deepStrictEqual(edits, []);
                } finally {
                    cancellation.dispose();
                }
            });
        }
    },
    {
        name: 'guards comment editing rules and grammar patterns',
        run: async () => {
            const root = path.resolve(__dirname, '../../..');
            const languageConfiguration = JSON.parse(
                await fs.readFile(path.join(root, 'language-configuration.json'), 'utf8')
            );
            const blockCommentPair = languageConfiguration.autoClosingPairs.find(
                (pair: unknown) => !Array.isArray(pair)
                    && typeof pair === 'object'
                    && pair !== null
                    && (pair as { open?: string }).open === '/*'
            );
            assert.deepStrictEqual(blockCommentPair, {
                open: '/*',
                close: '*/',
                notIn: ['string', 'comment']
            });

            const continuationRule = languageConfiguration.onEnterRules[3];
            const beforeText = new RegExp(continuationRule.beforeText);
            const previousLineText = new RegExp(continuationRule.previousLineText);
            assert.ok(beforeText.test('     * details'));
            assert.ok(previousLineText.test('    /**'));
            assert.ok(!beforeText.test('     * completed */'));
            assert.ok(!previousLineText.test('    value = left'));

            const grammar = JSON.parse(
                await fs.readFile(path.join(root, 'syntaxes', 'lpc.tmGrammar.json'), 'utf8')
            );
            const operatorReference = new RegExp(grammar.repository.lpc_closures.patterns[1].match);
            const functionDefinition = new RegExp(grammar.repository.function_definitions.patterns[0].match);
            const modifiers = new RegExp(grammar.repository.modifiers.patterns[0].match);
            const flowKeywords = new RegExp(grammar.repository.keywords.patterns[2].match);
            const coroutineEfuns = new RegExp(grammar.repository.efuns.patterns[1].match);
            const structLiteral = new RegExp(grammar.repository.arrays_mappings.patterns[2].begin);
            const hasOperator = (value: string): boolean => grammar.repository.operators.patterns.some(
                (pattern: { match: string }) => new RegExp(pattern.match).test(value)
            );
            assert.ok(operatorReference.test("#'["));
            assert.ok(operatorReference.test("#'[.."));
            assert.ok(operatorReference.test("#'."));
            assert.ok(functionDefinition.test('int *collect_values('));
            assert.ok(functionDefinition.test('struct result *collect_result('));
            assert.ok(functionDefinition.test('async int|string collect_values('));
            assert.ok(functionDefinition.test('int*|string* collect_values('));
            assert.ok(modifiers.test('async'));
            assert.ok(flowKeywords.test('await'));
            assert.ok(flowKeywords.test('yield'));
            assert.ok(coroutineEfuns.test('call_coroutine'));
            assert.ok(coroutineEfuns.test('this_coroutine'));
            assert.ok(structLiteral.test('(<Foo>'));
            assert.ok(hasOperator('>>>'));
            assert.ok(hasOperator('>>>='));
            assert.ok(hasOperator('&&='));
            assert.ok(hasOperator('||='));
            assert.ok(hasOperator('...'));
            assert.ok(hasOperator('.'));
        }
    }
];

export async function run(): Promise<void> {
    const allTests: TestCase[] = [
        ...await loadFormatterFixtureTests(),
        ...integrationTests
    ];
    const filter = process.env.LPC_TEST_FILTER?.toLowerCase();
    const selectedTests = filter
        ? allTests.filter(test => test.name.toLowerCase().includes(filter))
        : allTests;

    if (selectedTests.length === 0) {
        throw new Error(`No tests matched "${process.env.LPC_TEST_FILTER}".`);
    }

    const failures: string[] = [];
    for (const test of selectedTests) {
        try {
            await test.run();
            console.log(`[PASS] ${test.name}`);
        } catch (error) {
            const details = error instanceof Error ? error.stack ?? error.message : String(error);
            failures.push(`[FAIL] ${test.name}\n${details}`);
        }
    }

    if (failures.length > 0) {
        throw new Error(failures.join('\n\n'));
    }
}
