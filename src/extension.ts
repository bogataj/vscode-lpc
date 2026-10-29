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

    context.subscriptions.push(
        vscode.commands.registerCommand('lpc.associateCFiles', associateCFilesWithLpc)
    );
}

/**
 * Mudlibs use .c/.h for LPC, but the extension only claims .lpc so C projects are
 * unaffected. This adds `*.c`/`*.h` → lpc to the workspace's files.associations.
 */
export async function associateCFilesWithLpc(): Promise<boolean> {
    if (!vscode.workspace.workspaceFolders?.length) {
        void vscode.window.showErrorMessage('Open a folder or workspace before associating .c/.h files with LPC.');
        return false;
    }

    const files = vscode.workspace.getConfiguration('files');
    const current = files.inspect<Record<string, string>>('associations')?.workspaceValue ?? {};
    await files.update(
        'associations',
        { ...current, '*.c': 'lpc', '*.h': 'lpc' },
        vscode.ConfigurationTarget.Workspace
    );
    void vscode.window.showInformationMessage('.c and .h files in this workspace now open as LPC.');
    return true;
}

export function deactivate() {}
