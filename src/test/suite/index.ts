import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { LPCDocumentFormattingEditProvider } from '../../formatProvider';

interface TestCase {
    name: string;
    run: () => Promise<void>;
}

const formattingOptions: vscode.FormattingOptions = {
    insertSpaces: true,
    tabSize: 4
};

async function withLpcDocument<T>(content: string, callback: (document: vscode.TextDocument) => T | Promise<T>): Promise<T> {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-lpc-test-'));
    const filePath = path.join(temporaryDirectory, 'test.lpc');

    try {
        await fs.writeFile(filePath, content, 'utf8');
        const document = await vscode.workspace.openTextDocument(filePath);
        assert.strictEqual(document.languageId, 'lpc');
        return await callback(document);
    } finally {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
}

async function formatDocument(content: string): Promise<string> {
    return withLpcDocument(content, document => {
        const provider = new LPCDocumentFormattingEditProvider();
        const cancellation = new vscode.CancellationTokenSource();
        try {
            const edits = provider.provideDocumentFormattingEdits(document, formattingOptions, cancellation.token);
            assert.ok(edits.length <= 1);
            return edits[0]?.newText ?? document.getText();
        } finally {
            cancellation.dispose();
        }
    });
}

const tests: TestCase[] = [
    {
        name: 'preserves comments and character literals',
        run: async () => {
            const input = [
                'void test() {',
                "int brace = '{';",
                'int value=1; /* keep a+b and x=2 */',
                'write("ok");',
                '}'
            ].join('\n');
            const expected = [
                'void test() {',
                "    int brace = '{';",
                '    int value = 1; /* keep a+b and x=2 */',
                '    write("ok");',
                '}',
                ''
            ].join('\n');

            assert.strictEqual(await formatDocument(input), expected);
        }
    },
    {
        name: 'formats quoted symbols and pointer-return functions',
        run: async () => {
            const input = [
                'int *query_values()',
                '{',
                "mixed value='symbol+1;",
                'return ({ value });',
                '}'
            ].join('\n');
            const expected = [
                'int *query_values() {',
                "    mixed value = 'symbol + 1;",
                '    return ({ value });',
                '}',
                ''
            ].join('\n');

            assert.strictEqual(await formatDocument(input), expected);
        }
    },
    {
        name: 'keeps nested switch contexts independent',
        run: async () => {
            const input = [
                'void test(int outer, int inner) {',
                'switch(outer) {',
                'case 1:',
                'switch(inner) {',
                'case 2:',
                'write("inner");',
                'break;',
                '}',
                'break;',
                'case 3:',
                'write("outer");',
                'break;',
                '}',
                '}'
            ].join('\n');
            const expected = [
                'void test(int outer, int inner) {',
                '    switch(outer) {',
                '    case 1:',
                '        switch(inner) {',
                '        case 2:',
                '            write("inner");',
                '            break;',
                '        }',
                '        break;',
                '    case 3:',
                '        write("outer");',
                '        break;',
                '    }',
                '}',
                ''
            ].join('\n');

            assert.strictEqual(await formatDocument(input), expected);
        }
    },
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
        }
    },
    {
        name: 'keeps the comprehensive formatter fixture unchanged',
        run: async () => {
            const fixturePath = path.resolve(__dirname, '../../..', 'formatted-lpc-test.lpc');
            const expectedPath = path.resolve(__dirname, '../../..', 'expected-result.lpc');
            const input = await fs.readFile(fixturePath, 'utf8');
            const expected = await fs.readFile(expectedPath, 'utf8');
            assert.strictEqual(input.replace(/\r\n/g, '\n'), expected.replace(/\r\n/g, '\n'));
            const formatted = await formatDocument(input);
            assert.strictEqual(formatted, input);
            assert.strictEqual(await formatDocument(formatted), formatted);
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
            assert.ok(operatorReference.test("#'["));
            assert.ok(operatorReference.test("#'[.."));
            assert.ok(functionDefinition.test('int *query_values('));
            assert.ok(functionDefinition.test('struct result *query_result('));
        }
    }
];

export async function run(): Promise<void> {
    const filter = process.env.LPC_TEST_FILTER?.toLowerCase();
    const selectedTests = filter
        ? tests.filter(test => test.name.toLowerCase().includes(filter))
        : tests;

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
