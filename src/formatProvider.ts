import * as vscode from 'vscode';
import { FormattedLineRange, mapFormattedLineRange } from './formatRange';
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

    /**
     * Formats the whole document, so the selection keeps its context (enclosing blocks,
     * `switch`, open delimiters, `#if` branches), and returns the selected lines of the result.
     */
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

        const text = document.getText();
        const originalLines = text.split(/\r?\n/);
        const lastSelectedLine = range.end.character === 0 && range.end.line > range.start.line
            ? range.end.line - 1
            : range.end.line;
        const { formatOptions, indentSize } = this.readFormatSettings(config, options);

        // Compacting a function joins lines, which would pull a header or closing brace
        // outside the selection into the edit; in that case the function keeps its layout.
        const compactChoices = formatOptions.compactSingleStatementFunctions !== false ? [true, false] : [false];
        let formattedLines: string[] = [];
        let mapping: FormattedLineRange | undefined;
        for (const compactSingleStatementFunctions of compactChoices) {
            const formatted = this.formatter.format(
                text,
                { ...formatOptions, compactSingleStatementFunctions },
                indentSize,
                token
            );
            if (token.isCancellationRequested) {
                return [];
            }
            formattedLines = formatted.split('\n');
            mapping = mapFormattedLineRange(originalLines, formattedLines, range.start.line, lastSelectedLine);
            if (!mapping || mapping.exact) {
                break;
            }
        }
        if (!mapping) {
            return [];
        }

        const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
        const hasFollowingLine = mapping.endLine + 1 < document.lineCount;
        const replacedRange = new vscode.Range(
            new vscode.Position(mapping.startLine, 0),
            hasFollowingLine
                ? new vscode.Position(mapping.endLine + 1, 0)
                : document.lineAt(mapping.endLine).range.end
        );
        const formattedText = formattedLines
            .slice(mapping.formattedStartLine, mapping.formattedEndLine + 1)
            .join(eol) + (hasFollowingLine ? eol : '');
        if (formattedText === document.getText(replacedRange)) {
            return [];
        }

        return [vscode.TextEdit.replace(replacedRange, formattedText)];
    }

    /** The formatter emits LF; match the document so an unchanged CRLF file produces no edit. */
    private withDocumentLineEndings(text: string, document: vscode.TextDocument): string {
        return document.eol === vscode.EndOfLine.CRLF ? text.replace(/\r?\n/g, '\r\n') : text;
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
