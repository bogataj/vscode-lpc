import * as vscode from 'vscode';
import { LPCFormatter } from './formatter';

export class LPCDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
    private readonly formatter = new LPCFormatter();

    public provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        const config = vscode.workspace.getConfiguration('lpc.formatting');
        if (!config.get<boolean>('enabled', true)) {
            return [];
        }

        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        const text = document.getText(fullRange);
        const indentSize = this.resolveIndentSize(config.get<number>('indentSize'), options.tabSize);
        let formattedText = this.formatter.format(text, options, indentSize, token);

        if (config.get<boolean>('insertFinalNewline', true) && !formattedText.endsWith('\n')) {
            formattedText += '\n';
        }

        if (formattedText === text) {
            return [];
        }

        return [vscode.TextEdit.replace(fullRange, formattedText)];
    }

    public provideDocumentRangeFormattingEdits(
        document: vscode.TextDocument,
        range: vscode.Range,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        const config = vscode.workspace.getConfiguration('lpc.formatting');
        if (!config.get<boolean>('enabled', true)) {
            return [];
        }

        const formattingRange = this.expandRangeToFullLines(document, range);
        const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), formattingRange.start));
        if (this.formatter.startsInsideProtectedContext(prefix)) {
            return [];
        }
        const text = document.getText(formattingRange);
        const indentSize = this.resolveIndentSize(config.get<number>('indentSize'), options.tabSize);
        const initialIndentLevel = this.formatter.getInitialIndentLevel(text, options, indentSize);
        const formattedText = this.formatter.format(text, options, indentSize, token, initialIndentLevel);

        if (formattedText === text) {
            return [];
        }

        return [vscode.TextEdit.replace(formattingRange, formattedText)];
    }

    private expandRangeToFullLines(document: vscode.TextDocument, range: vscode.Range): vscode.Range {
        const start = new vscode.Position(range.start.line, 0);
        if (range.end.character === 0 && range.end.line > range.start.line) {
            return new vscode.Range(start, range.end);
        }

        const nextLine = range.end.line + 1;
        const end = nextLine < document.lineCount
            ? new vscode.Position(nextLine, 0)
            : document.lineAt(range.end.line).range.end;
        return new vscode.Range(start, end);
    }

    private resolveIndentSize(configuredIndentSize: number | undefined, fallback: number): number {
        return Number.isInteger(configuredIndentSize) && configuredIndentSize !== undefined && configuredIndentSize > 0
            ? configuredIndentSize
            : Math.max(1, Math.floor(fallback));
    }
}
