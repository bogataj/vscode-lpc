import * as vscode from 'vscode';
export declare class LPCDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
    provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.TextEdit[];
    provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.TextEdit[];
    private formatLPCCode;
    private preprocessLines;
    private handleSpecialLine;
    private normalizeSpacing;
    private alignInlineComment;
    private countBracesAndStructures;
    private isInsideString;
    private replaceOutsideStrings;
    private postProcessMultiLinePatterns;
    private needsContinuation;
    private hasUnclosedBrackets;
    private stripCommentsAndStrings;
    private isControlStatementWithoutBrace;
}
//# sourceMappingURL=formatProvider.d.ts.map