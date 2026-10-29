import * as assert from 'assert';
import * as vscode from 'vscode';
import { LPCDocumentFormattingEditProvider } from '../../formatProvider';
import { formattingOptions, withLpcDocument } from './formatTestUtils';

interface TestCase {
    name: string;
    run: () => Promise<void>;
}

const unformatted = 'void f() {\nx=1;\nreturn;\n}';

function formatEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions = formattingOptions,
    cancel = false
): vscode.TextEdit[] {
    const provider = new LPCDocumentFormattingEditProvider();
    const cancellation = new vscode.CancellationTokenSource();
    try {
        if (cancel) {
            cancellation.cancel();
        }
        return provider.provideDocumentFormattingEdits(document, options, cancellation.token);
    } finally {
        cancellation.dispose();
    }
}

async function withSetting<T>(key: string, value: unknown, callback: () => Promise<T>): Promise<T> {
    const config = vscode.workspace.getConfiguration('lpc.formatting');
    await config.update(key, value, vscode.ConfigurationTarget.Global);
    try {
        return await callback();
    } finally {
        await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }
}

export const providerTests: TestCase[] = [
    {
        name: 'provider honors formatting settings',
        run: async () => {
            await withSetting('enabled', false, () => withLpcDocument(unformatted, document => {
                assert.deepStrictEqual(formatEdits(document), []);
            }));

            await withSetting('insertFinalNewline', false, () => withLpcDocument(unformatted, document => {
                assert.strictEqual(formatEdits(document)[0].newText, 'void f() {\n    x = 1;\n    return;\n}');
            }));

            await withSetting('indentSize', 2, () => withLpcDocument(unformatted, document => {
                assert.strictEqual(formatEdits(document)[0].newText, 'void f() {\n  x = 1;\n  return;\n}\n');
            }));
        }
    },
    {
        name: 'provider keeps CRLF line endings',
        run: async () => {
            await withLpcDocument(unformatted.replace(/\n/g, '\r\n'), document => {
                assert.strictEqual(document.eol, vscode.EndOfLine.CRLF);
                const edits = formatEdits(document);
                assert.strictEqual(edits.length, 1);
                assert.strictEqual(edits[0].newText, 'void f() {\r\n    x = 1;\r\n    return;\r\n}\r\n');
            });

            await withLpcDocument('void f() {\r\n    x = 1;\r\n    return;\r\n}\r\n', document => {
                assert.deepStrictEqual(formatEdits(document), []);
            });
        }
    },
    {
        name: 'provider returns no edits when cancelled',
        run: async () => {
            await withLpcDocument(unformatted, document => {
                assert.deepStrictEqual(formatEdits(document, formattingOptions, true), []);
            });
        }
    },
    {
        name: 'provider formats untitled LPC documents',
        run: async () => {
            const document = await vscode.workspace.openTextDocument({ language: 'lpc', content: unformatted });
            assert.strictEqual(document.uri.scheme, 'untitled');
            const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
                'vscode.executeFormatDocumentProvider',
                document.uri,
                formattingOptions
            );
            assert.ok(edits && edits.length > 0, 'expected the LPC formatter to handle untitled documents');
        }
    }
];
