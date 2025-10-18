import * as vscode from 'vscode';
import { LPCDocumentFormattingEditProvider } from './formatProvider';

export function activate(context: vscode.ExtensionContext) {
    const lpcFormattingProvider = new LPCDocumentFormattingEditProvider();
    
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(
            { scheme: 'file', language: 'lpc' },
            lpcFormattingProvider
        )
    );

    context.subscriptions.push(
        vscode.languages.registerDocumentRangeFormattingEditProvider(
            { scheme: 'file', language: 'lpc' },
            lpcFormattingProvider
        )
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('lpc.format', (textEditor) => {
            vscode.commands.executeCommand('editor.action.formatDocument');
        })
    );
}

export function deactivate() {}
