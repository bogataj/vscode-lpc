import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { LPCDocumentFormattingEditProvider } from '../../formatProvider';
import { fixtureDirectory, normalizeLineEndings } from '../fixtures';
import { loadFormatterFixtureTests } from './formatterFixtures';
import { formattingOptions, withLpcDocument } from './formatTestUtils';
import { providerTests } from './providerTests';

interface TestCase {
    name: string;
    run: () => Promise<void>;
}

interface GrammarPattern {
    name?: string;
    match?: string;
    begin?: string;
}

const repositoryRoot = path.resolve(__dirname, '../../..');

function rangeEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions = formattingOptions
): vscode.TextEdit[] {
    const provider = new LPCDocumentFormattingEditProvider();
    const cancellation = new vscode.CancellationTokenSource();
    try {
        return provider.provideDocumentRangeFormattingEdits(document, range, options, cancellation.token);
    } finally {
        cancellation.dispose();
    }
}

function documentText(document: vscode.TextDocument, options: vscode.FormattingOptions): string {
    const provider = new LPCDocumentFormattingEditProvider();
    const cancellation = new vscode.CancellationTokenSource();
    try {
        const edits = provider.provideDocumentFormattingEdits(document, options, cancellation.token);
        assert.strictEqual(edits.length, 1);
        return edits[0].newText;
    } finally {
        cancellation.dispose();
    }
}

async function readFixture(fileName: string): Promise<string> {
    return normalizeLineEndings(await fs.readFile(path.join(fixtureDirectory, fileName), 'utf8'));
}

async function readJson<T>(...segments: string[]): Promise<T> {
    return JSON.parse(await fs.readFile(path.join(repositoryRoot, ...segments), 'utf8')) as T;
}

/** Looks up a grammar pattern by scope name so tests do not depend on rule order. */
function grammarPattern(patterns: GrammarPattern[], name: string, index = 0): RegExp {
    const matches = patterns.filter(pattern => pattern.name === name);
    const pattern = matches[index];
    assert.ok(pattern, `Grammar pattern "${name}" not found.`);
    const source = pattern.match ?? pattern.begin;
    assert.ok(source, `Grammar pattern "${name}" has no match or begin expression.`);
    return new RegExp(source);
}

const integrationTests: TestCase[] = [
    {
        name: 'range formatting keeps the base indentation of spaces',
        run: async () => {
            const input = [
                'void outer() {',
                '    if (ready) {',
                '    write("ok");',
                '    }',
                '}'
            ].join('\n');
            await withLpcDocument(input, document => {
                const edits = rangeEdits(document, new vscode.Range(1, 0, 4, 0));
                assert.strictEqual(edits.length, 1);
                assert.strictEqual(edits[0].newText, [
                    '    if (ready) {',
                    '        write("ok");',
                    '    }',
                    ''
                ].join('\n'));
            });
        }
    },
    {
        name: 'range formatting keeps the base indentation of tabs',
        run: async () => {
            const input = [
                'void outer() {',
                '\tif (ready) {',
                '\twrite("ok");',
                '\t}',
                '}'
            ].join('\n');
            await withLpcDocument(input, document => {
                const edits = rangeEdits(document, new vscode.Range(1, 0, 4, 0), { insertSpaces: false, tabSize: 8 });
                assert.strictEqual(edits.length, 1);
                assert.strictEqual(edits[0].newText, [
                    '\tif (ready) {',
                    '\t\twrite("ok");',
                    '\t}',
                    ''
                ].join('\n'));
            });
        }
    },
    {
        name: 'document formatting normalizes mixed indentation to the configured style',
        run: async () => {
            const input = [
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
            await withLpcDocument(input, document => {
                assert.strictEqual(documentText(document, { insertSpaces: true, tabSize: 4 }), [
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

                assert.strictEqual(documentText(document, { insertSpaces: false, tabSize: 4 }), [
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
        }
    },
    {
        name: 'range formatting expands a partial selection to whole lines',
        run: async () => {
            await withLpcDocument(['void outer() {', '    int value=1;', '}'].join('\n'), document => {
                const edits = rangeEdits(document, new vscode.Range(1, 8, 1, 13));
                assert.strictEqual(edits.length, 1);
                assert.deepStrictEqual(edits[0].range, new vscode.Range(1, 0, 2, 0));
                assert.strictEqual(edits[0].newText, '    int value = 1;\n');
            });
        }
    },
    {
        name: 'range formatting can start at a closing brace',
        run: async () => {
            const input = [
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
            await withLpcDocument(input, document => {
                const edits = rangeEdits(document, new vscode.Range(3, 0, 8, 0));
                assert.strictEqual(edits.length, 1);
                assert.strictEqual(edits[0].newText, [
                    '    }',
                    '    else',
                    '        fallback();',
                    '    if (other)',
                    '        next();',
                    ''
                ].join('\n'));
            });
        }
    },
    {
        name: 'range formatting inside a continued string makes no edits',
        run: async () => {
            await withLpcDocument(await readFixture('continued-string-content.expected.lpc'), document => {
                assert.deepStrictEqual(rangeEdits(document, new vscode.Range(2, 0, 3, 0)), []);
            });
        }
    },
    {
        name: 'range formatting inside a preprocessor branch keeps its context',
        run: async () => {
            await withLpcDocument(await readFixture('range-preprocessor-context.expected.lpc'), document => {
                assert.deepStrictEqual(rangeEdits(document, new vscode.Range(1, 0, 8, 0)), []);
            });
        }
    },
    {
        name: 'language configuration guards comment editing rules',
        run: async () => {
            interface EnterRule { beforeText: string; previousLineText?: string; action: { appendText?: string } }
            const configuration = await readJson<{ autoClosingPairs: unknown[]; onEnterRules: EnterRule[] }>(
                'language-configuration.json'
            );
            const blockCommentPair = configuration.autoClosingPairs.find(
                pair => !Array.isArray(pair)
                    && typeof pair === 'object'
                    && pair !== null
                    && (pair as { open?: string }).open === '/*'
            );
            assert.deepStrictEqual(blockCommentPair, {
                open: '/*',
                close: '*/',
                notIn: ['string', 'comment']
            });

            const continuationRule = configuration.onEnterRules.find(rule => rule.previousLineText !== undefined);
            assert.ok(continuationRule?.previousLineText, 'Doc comment continuation rule not found.');
            const beforeText = new RegExp(continuationRule.beforeText);
            const previousLineText = new RegExp(continuationRule.previousLineText);
            assert.ok(beforeText.test('     * details'));
            assert.ok(previousLineText.test('    /**'));
            assert.ok(!beforeText.test('     * completed */'));
            assert.ok(!previousLineText.test('    value = left'));
        }
    },
    {
        name: 'grammar recognizes LPC syntax patterns',
        run: async () => {
            interface Grammar { repository: Record<string, { patterns: GrammarPattern[] }> }
            const { repository } = await readJson<Grammar>('syntaxes', 'lpc.tmGrammar.json');
            const operatorReference = grammarPattern(repository.lpc_closures.patterns, 'entity.name.function.pointer.operator.lpc');
            const functionDefinition = grammarPattern(repository.function_definitions.patterns, 'meta.function.lpc');
            const modifiers = grammarPattern(repository.modifiers.patterns, 'storage.modifier.lpc');
            const flowKeywords = grammarPattern(repository.keywords.patterns, 'keyword.control.flow.lpc');
            const efuns = grammarPattern(repository.efuns.patterns, 'support.function.builtin.lpc');
            const coroutineEfuns = grammarPattern(repository.efuns.patterns, 'support.function.coroutine.lpc');
            const applies = grammarPattern(repository.applies.patterns, 'support.function.apply.lpc');
            const structLiteral = grammarPattern(repository.arrays_mappings.patterns, 'meta.struct.literal.lpc');
            const hasOperator = (value: string): boolean => repository.operators.patterns.some(
                pattern => pattern.match !== undefined && new RegExp(pattern.match).test(value)
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
            assert.ok(coroutineEfuns.test('call_coroutine('));
            assert.ok(coroutineEfuns.test('this_coroutine ('));
            assert.ok(efuns.test('write("text")'));
            assert.ok(efuns.test('configure_object(target)'));
            assert.ok(!efuns.test('int time;'), 'efun names used as variables are not highlighted');
            assert.ok(applies.test('create()'));
            assert.ok(!applies.test('id = 2'), 'apply names used as variables are not highlighted');
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
        ...integrationTests,
        ...providerTests
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
