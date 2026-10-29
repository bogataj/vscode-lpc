import * as vscode from 'vscode';
import { LPCFormatOptions, LPCFormatter } from './formatter';

export class LPCDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
    private readonly formatter = new LPCFormatter();

    public provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        const config = vscode.workspace.getConfiguration('lpc.formatting', document);
        if (!config.get<boolean>('enabled', true)) {
            return [];
        }

        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        const text = document.getText(fullRange);
        const { formatOptions, indentSize } = this.readFormatSettings(config, options);
        let formattedText = this.formatter.format(text, formatOptions, indentSize, token);
        if (token.isCancellationRequested) {
            return [];
        }

        if (config.get<boolean>('insertFinalNewline', true) && !formattedText.endsWith('\n')) {
            formattedText += '\n';
        }

        formattedText = this.withDocumentLineEndings(formattedText, document);
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
        const config = vscode.workspace.getConfiguration('lpc.formatting', document);
        if (!config.get<boolean>('enabled', true)) {
            return [];
        }

        const formattingRange = this.expandRangeToFullLines(document, range);
        const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), formattingRange.start));
        if (this.formatter.startsInsideProtectedContext(prefix)) {
            return [];
        }
        const text = document.getText(formattingRange);
        const { formatOptions, indentSize } = this.readFormatSettings(config, options);
        const initialIndentLevel = this.formatter.getInitialIndentLevel(text, formatOptions, indentSize);
        const formattedText = this.withDocumentLineEndings(
            this.formatter.format(text, formatOptions, indentSize, token, initialIndentLevel),
            document
        );
        if (token.isCancellationRequested || formattedText === text) {
            return [];
        }

        return [vscode.TextEdit.replace(formattingRange, formattedText)];
    }

    /** The formatter emits LF; match the document so an unchanged CRLF file produces no edit. */
    private withDocumentLineEndings(text: string, document: vscode.TextDocument): string {
        return document.eol === vscode.EndOfLine.CRLF ? text.replace(/\r?\n/g, '\r\n') : text;
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

    /**
     * `lpc.formatting.indentSize` (default 4) sets the spaces per level and takes precedence
     * over the editor's tab size; with tabs, each level is one tab. The editor's tab size is
     * only used to measure existing tabs and as a fallback for an invalid setting.
     */
    private readFormatSettings(
        config: vscode.WorkspaceConfiguration,
        options: vscode.FormattingOptions
    ): { formatOptions: LPCFormatOptions; indentSize: number } {
        const configuredIndentSize = config.get<number>('indentSize', 4);
        const indentSize = Number.isInteger(configuredIndentSize) && configuredIndentSize > 0
            ? configuredIndentSize
            : Math.max(1, Math.floor(options.tabSize));
        return {
            formatOptions: {
                insertSpaces: options.insertSpaces,
                tabSize: options.tabSize,
                compactSingleStatementFunctions: config.get<boolean>('compactSingleStatementFunctions', true)
            },
            indentSize
        };
    }
}
