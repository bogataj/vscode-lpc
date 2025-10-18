import * as vscode from 'vscode';
export declare class LPCDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
    provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.TextEdit[];
    provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.TextEdit[];
    private formatLPCCode;
    private needsContinuation;
    private hasUnclosedBrackets;
    private isControlStatementWithoutBrace;
}
//# sourceMappingURL=formatProvider.d.ts.map