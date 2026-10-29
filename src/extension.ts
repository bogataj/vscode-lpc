import * as vscode from 'vscode';
import { LPCDocumentFormattingEditProvider } from './formatProvider';

// Any scheme, so untitled documents and virtual workspaces are formatted too.
const lpcDocuments: vscode.DocumentSelector = { language: 'lpc' };

export function activate(context: vscode.ExtensionContext) {
    const lpcFormattingProvider = new LPCDocumentFormattingEditProvider();

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(
            lpcDocuments,
            lpcFormattingProvider
        )
    );

    context.subscriptions.push(
        vscode.languages.registerDocumentRangeFormattingEditProvider(
            lpcDocuments,
            lpcFormattingProvider
        )
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand(
            'lpc.format',
            () => vscode.commands.executeCommand('editor.action.formatDocument')
        )
    );
}

export function deactivate() {}
