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

            const singleStatement = 'int query_level()\n{\nreturn level;\n}';
            await withLpcDocument(singleStatement, document => {
                assert.strictEqual(formatEdits(document)[0].newText, 'int query_level() { return level; }\n');
            });
            await withSetting('compactSingleStatementFunctions', false, () => withLpcDocument(singleStatement, document => {
                assert.strictEqual(formatEdits(document)[0].newText, 'int query_level()\n{\n    return level;\n}\n');
            }));
        }
    },
    {
        name: 'provider indents with lpc.formatting.indentSize regardless of the editor tab size',
        run: async () => {
            const expectedFourSpaces = 'void f() {\n    x = 1;\n    return;\n}\n';
            for (const tabSize of [2, 8]) {
                await withLpcDocument(unformatted, document => {
                    assert.strictEqual(formatEdits(document, { insertSpaces: true, tabSize })[0].newText, expectedFourSpaces);
                });
            }

            await withSetting('indentSize', 3, () => withLpcDocument(unformatted, document => {
                assert.strictEqual(
                    formatEdits(document, { insertSpaces: true, tabSize: 8 })[0].newText,
                    'void f() {\n   x = 1;\n   return;\n}\n'
                );
            }));

            await withLpcDocument(unformatted, document => {
                assert.strictEqual(
                    formatEdits(document, { insertSpaces: false, tabSize: 8 })[0].newText,
                    'void f() {\n\tx = 1;\n\treturn;\n}\n'
                );
            });
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
        name: 'c files stay C until the workspace opts in to LPC',
        run: async () => {
            const folder = vscode.workspace.workspaceFolders?.[0];
            assert.ok(folder, 'The test host should open a workspace folder.');
            const files = vscode.workspace.getConfiguration('files');
            const openC = async (name: string): Promise<string> => {
                const uri = vscode.Uri.joinPath(folder.uri, name);
                await vscode.workspace.fs.writeFile(uri, Buffer.from('int main() { return 0; }\n'));
                return (await vscode.workspace.openTextDocument(uri)).languageId;
            };

            try {
                assert.notStrictEqual(await openC('before.c'), 'lpc');

                assert.strictEqual(await vscode.commands.executeCommand('lpc.associateCFiles'), true);
                const associations = files.inspect<Record<string, string>>('associations')?.workspaceValue;
                assert.strictEqual(associations?.['*.c'], 'lpc');
                assert.strictEqual(associations?.['*.h'], 'lpc');
                assert.strictEqual(await openC('after.c'), 'lpc');
            } finally {
                await files.update('associations', undefined, vscode.ConfigurationTarget.Workspace);
            }
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
