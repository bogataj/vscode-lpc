import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { LPCDocumentFormattingEditProvider } from '../../formatProvider';

export const formattingOptions: vscode.FormattingOptions = {
    insertSpaces: true,
    tabSize: 4
};

export async function withLpcDocument<T>(
    content: string,
    callback: (document: vscode.TextDocument) => T | Promise<T>
): Promise<T> {
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

export async function formatDocument(content: string): Promise<string> {
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
