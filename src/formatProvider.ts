import * as vscode from 'vscode';

interface BracketInfo {
    char: string;
    assignedIndent: number;
}

interface SpecialLineResult {
    handled: boolean;
    output?: string | string[];
    inBlockComment?: boolean;
    blockCommentIndent?: number;
    updateIndentLevel?: number;
    resetFlags?: boolean;
    clearBracketStack?: boolean;
}

interface SwitchContext {
    indentLevel: number;
    lastLineWasCaseLabel: boolean;
    inCaseBody: boolean;
}

const LPC_SIMPLE_TYPE_PATTERN = 'void|int|float|string|object|mapping|mixed|status|closure|symbol|bytes|lwobject|coroutine|lpctype';
const LPC_TYPE_PATTERN = `${LPC_SIMPLE_TYPE_PATTERN}|struct`;
const LPC_DECLARATION_TYPE_PATTERN = `(?:${LPC_SIMPLE_TYPE_PATTERN}|struct(?:\\s+[A-Za-z_]\\w*)?)`;
const LPC_MODIFIER_PATTERN = 'static|private|protected|public|nomask|deprecated|varargs|virtual|nosave';
const LPC_FUNCTION_DECLARATION_PATTERN = new RegExp(
    `^(?:(?:${LPC_MODIFIER_PATTERN})\\s+)*(?:${LPC_DECLARATION_TYPE_PATTERN})\\s+(?:\\*+\\s*)?\\w+\\s*\\([^)]*\\)\\s*$`
);
const LPC_CAST_SUFFIX_PATTERN = new RegExp(`^(?:${LPC_TYPE_PATTERN})\\s*\\)`);
const LPC_TYPE_WITH_OPTIONAL_POINTER_PATTERN = new RegExp(`^(?:${LPC_TYPE_PATTERN})\\*?$`);

class CharacterScanner {
    inString = false;
    inLineComment = false;
    inBlockComment = false;
    private stringDelimiter: '"' | "'" | null = null;

    /** Process one character, updating state. */
    processChar(line: string, index: number): { skip: boolean; skipNext: boolean } {
        const char = line[index];
        const nextChar = index + 1 < line.length ? line[index + 1] : '';

        if (this.inLineComment) {
            return { skip: true, skipNext: false };
        }

        if (this.inBlockComment) {
            if (char === '*' && nextChar === '/') {
                this.inBlockComment = false;
                return { skip: true, skipNext: true };
            }
            return { skip: true, skipNext: false };
        }

        if (this.inString) {
            if (char === this.stringDelimiter && !this.isEscaped(line, index)) {
                this.inString = false;
                this.stringDelimiter = null;
            }
            return { skip: true, skipNext: false };
        }

        if (char === '"' || (char === "'" && this.isCharacterLiteralStart(line, index))) {
            this.inString = true;
            this.stringDelimiter = char;
            return { skip: true, skipNext: false };
        }

        if (char === '/' && nextChar === '/') {
            this.inLineComment = true;
            return { skip: true, skipNext: false };
        }

        if (char === '/' && nextChar === '*') {
            this.inBlockComment = true;
            return { skip: true, skipNext: true };
        }

        return { skip: false, skipNext: false };
    }

    private isEscaped(line: string, index: number): boolean {
        let backslashCount = 0;
        for (let i = index - 1; i >= 0 && line[i] === '\\'; i--) {
            backslashCount++;
        }
        return backslashCount % 2 === 1;
    }

    private isCharacterLiteralStart(line: string, index: number): boolean {
        if (line[index + 1] === '\\') {
            return index + 3 < line.length && line[index + 3] === "'";
        }
        return index + 2 < line.length && line[index + 2] === "'";
    }

}

export class LPCDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
    
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
        let formattedText = this.formatLPCCode(text, options, indentSize, token);

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
        const text = document.getText(formattingRange);
        const indentSize = this.resolveIndentSize(config.get<number>('indentSize'), options.tabSize);
        const initialIndentLevel = this.getInitialIndentLevel(text, options, indentSize);
        const formattedText = this.formatLPCCode(text, options, indentSize, token, initialIndentLevel);

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

    private getInitialIndentLevel(code: string, options: vscode.FormattingOptions, indentSize: number): number {
        const firstContentLine = code.split(/\r?\n/).find(line => line.trim().length > 0);
        if (!firstContentLine) {
            return 0;
        }

        const leadingWhitespace = firstContentLine.match(/^[\t ]*/)?.[0] ?? '';
        if (!options.insertSpaces) {
            const tabCount = (leadingWhitespace.match(/\t/g) || []).length;
            const spaceCount = (leadingWhitespace.match(/ /g) || []).length;
            const baseIndent = tabCount + Math.floor(spaceCount / indentSize);
            const startsWithClosingBrace = firstContentLine.trimStart().startsWith('}')
                && !firstContentLine.trimStart().match(/^}\s*[)\]>]/);
            return baseIndent + (startsWithClosingBrace ? 1 : 0);
        }

        let columns = 0;
        for (const char of leadingWhitespace) {
            columns += char === '\t' ? options.tabSize : 1;
        }

        const baseIndent = Math.floor(columns / indentSize);
        const startsWithClosingBrace = firstContentLine.trimStart().startsWith('}')
            && !firstContentLine.trimStart().match(/^}\s*[)\]>]/);
        return baseIndent + (startsWithClosingBrace ? 1 : 0);
    }

    private formatLPCCode(
        code: string,
        options: vscode.FormattingOptions,
        indentSize: number,
        token?: vscode.CancellationToken,
        initialIndentLevel = 0
    ): string {
        const indentString = options.insertSpaces
            ? ' '.repeat(indentSize)
            : '\t';
        
        let lines = this.preprocessLines(code.split(/\r?\n/));
        
        let result: string[] = [];
        let indentLevel = initialIndentLevel;
        const switchStack: SwitchContext[] = [];
        let previousLineNeedsContinuation = false;
        let previousCurrentIndent = 0;
        let previousLineHadUnclosedBrackets = false;
        let inMultiLineControlStatement = false;
        let stringContinuationColumn = -1;
        let lpcStructureIndentStack: number[] = [];
        let inBlockComment = false;
        let blockCommentIndent = 0;
        let expectSingleStatementIndent = false;
        let lpcDataStructureDepth = 0;
        const bracketStack: BracketInfo[] = [];
        let preprocessorIndentStack: number[] = [];
        let inBackslashStringContinuation = false;

        for (let i = 0; i < lines.length; i++) {
            if (token?.isCancellationRequested) {
                return code;
            }

            const line = lines[i];
            const trimmed = line.trim();
            
            // Handle backslash string continuation - preserve original line as-is
            if (inBackslashStringContinuation) {
                result.push(line);
                // Check if this line also ends with backslash to continue
                inBackslashStringContinuation = line.trimEnd().endsWith('\\');
                continue;
            }
            
            const specialLineResult = this.handleSpecialLine(
                trimmed, 
                indentLevel,
                {
                    inBlockComment,
                    blockCommentIndent,
                    preprocessorIndentStack
                },
                indentString
            );
            
            if (specialLineResult.handled) {
                if (specialLineResult.output !== undefined) {
                    if (Array.isArray(specialLineResult.output)) {
                        result.push(...specialLineResult.output);
                    } else {
                        result.push(specialLineResult.output);
                    }
                }
                
                if (specialLineResult.inBlockComment !== undefined) {
                    inBlockComment = specialLineResult.inBlockComment;
                }
                if (specialLineResult.blockCommentIndent !== undefined) {
                    blockCommentIndent = specialLineResult.blockCommentIndent;
                }
                if (specialLineResult.updateIndentLevel !== undefined) {
                    indentLevel = specialLineResult.updateIndentLevel;
                }
                
                if (specialLineResult.resetFlags) {
                    previousLineNeedsContinuation = false;
                    expectSingleStatementIndent = false;
                    const activeSwitch = switchStack[switchStack.length - 1];
                    if (activeSwitch) {
                        activeSwitch.lastLineWasCaseLabel = false;
                    }
                }
                
                if (specialLineResult.clearBracketStack) {
                    bracketStack.length = 0;
                    lpcStructureIndentStack.length = 0;
                }
                
                continue;
            }

            let currentIndent = indentLevel;
            let leadingCloseBraceHandled = false;
            
            if (trimmed.startsWith('}') && !trimmed.match(/^}\s*[)\]>]/)) {
                indentLevel = Math.max(0, indentLevel - 1);
                currentIndent = indentLevel;
                leadingCloseBraceHandled = true;
                while (switchStack.length > 0
                    && indentLevel <= switchStack[switchStack.length - 1].indentLevel) {
                    switchStack.pop();
                }
            }
            
            if (trimmed.match(/^[}\]>]\s*\)/) && lpcStructureIndentStack.length > 0) {
                if (lpcStructureIndentStack.length > 0) {
                    currentIndent = Math.max(0, lpcStructureIndentStack[lpcStructureIndentStack.length - 1] - 1);
                } else {
                    currentIndent = indentLevel;
                }
            }
            
            if (trimmed.match(/\bswitch\s*\(/)) {
                switchStack.push({
                    indentLevel,
                    lastLineWasCaseLabel: false,
                    inCaseBody: false
                });
            }

            const activeSwitch = switchStack[switchStack.length - 1];
            
            if (activeSwitch && trimmed.match(/^(case\s+.*:|default\s*:)/)) {
                currentIndent = activeSwitch.indentLevel;
                activeSwitch.lastLineWasCaseLabel = true;
                activeSwitch.inCaseBody = true;
            }
            else if (activeSwitch && trimmed === 'break;') {
                currentIndent = indentLevel;
                activeSwitch.inCaseBody = false;
            }
            else if (activeSwitch && activeSwitch.inCaseBody && !trimmed.match(/^(case\s+|default\s*:)/) && !expectSingleStatementIndent) {
                currentIndent = indentLevel;
                activeSwitch.lastLineWasCaseLabel = false;
            }
            else if (activeSwitch && activeSwitch.lastLineWasCaseLabel && !trimmed.match(/^(case\s+|default\s*:)/) && !expectSingleStatementIndent) {
                if (!trimmed.startsWith('//')) {
                    currentIndent = indentLevel;
                    activeSwitch.lastLineWasCaseLabel = false;
                } else {
                    currentIndent = indentLevel + 1;
                }
            }
            
            else if (expectSingleStatementIndent) {
                if (!trimmed.startsWith('{')) {
                    currentIndent = indentLevel + 1;
                }
                const isConditionContinuation = inMultiLineControlStatement && previousLineHadUnclosedBrackets;
                if (!isConditionContinuation) {
                    expectSingleStatementIndent = false;
                    if (inMultiLineControlStatement) {
                        inMultiLineControlStatement = false;
                    }
                }
                if (activeSwitch) {
                    activeSwitch.lastLineWasCaseLabel = false;
                }
            }
            else if (trimmed.startsWith(')')) {
                let matchingParen = null;
                for (let j = bracketStack.length - 1; j >= 0; j--) {
                    if (bracketStack[j].char === '(') {
                        matchingParen = bracketStack[j];
                        break;
                    }
                }
                
                if (matchingParen) {
                    currentIndent = matchingParen.assignedIndent;
                } else if (lpcStructureIndentStack.length > 0 && trimmed.startsWith('),')) {
                    currentIndent = lpcStructureIndentStack[lpcStructureIndentStack.length - 1];
                } else {
                    currentIndent = indentLevel;
                }
                if (activeSwitch) {
                    activeSwitch.lastLineWasCaseLabel = false;
                }
            }
            else if (previousLineNeedsContinuation && bracketStack.length > 0 && bracketStack[bracketStack.length - 1].char === '(' && !trimmed.match(/^[)}\]>]/)) {
                // Use continuation indent for function arguments (base indent + 1)
                const parenMatch = bracketStack[bracketStack.length - 1];
                currentIndent = parenMatch.assignedIndent + 1;
                if (activeSwitch) {
                    activeSwitch.lastLineWasCaseLabel = false;
                }
            }
            else if (trimmed.match(/^(&&|\|\|)/) && lpcDataStructureDepth === 0) {
                currentIndent = Math.max(indentLevel + 1, previousCurrentIndent);
                if (activeSwitch) {
                    activeSwitch.lastLineWasCaseLabel = false;
                }
            }
            else if (previousLineNeedsContinuation && lpcDataStructureDepth === 0) {
                const previousLine = i > 0 ? lines[i - 1].trim() : '';
                const previousFormattedLine = result.length > 0 ? result[result.length - 1] : '';
                const isNewMappingKey = trimmed.match(/^"[^"]+"\s*:\s*\(/);
                const previousWasMappingValue = previousLine.match(/\}\),\s*$/);
                
                if (trimmed.startsWith('"') && previousLine.endsWith('+')) {
                    let columnToUse = stringContinuationColumn;
                    
                    if (columnToUse < 0) {
                        let quotePos = previousFormattedLine.indexOf('"');
                        if (quotePos === -1 && result.length >= 2) {
                            for (let j = result.length - 2; j >= 0; j--) {
                                const checkLine = result[j];
                                const checkLineTrimmed = checkLine.trim();
                                quotePos = checkLine.indexOf('"');
                                if (quotePos !== -1) {
                                    break;
                                }
                                if (!checkLineTrimmed.endsWith('+')) {
                                    break;
                                }
                            }
                        }
                        if (quotePos !== -1) {
                            columnToUse = quotePos;
                            stringContinuationColumn = quotePos;
                        }
                    }
                    
                    if (columnToUse >= 0) {
                        currentIndent = indentLevel + 1;
                    } else {
                        currentIndent = Math.max(indentLevel + 1, previousCurrentIndent);
                        stringContinuationColumn = -1;
                    }
                } else {
                    stringContinuationColumn = -1;
                    if (isNewMappingKey && previousWasMappingValue) {
                        currentIndent = indentLevel;
                    } else {
                        currentIndent = Math.max(indentLevel + 1, previousCurrentIndent);
                    }
                }
                if (activeSwitch) {
                    activeSwitch.lastLineWasCaseLabel = false;
                }
            }
            else if (lpcStructureIndentStack.length > 0 && !trimmed.match(/^[}\]>]\s*\)/) && trimmed !== ')') {
                currentIndent = lpcStructureIndentStack[lpcStructureIndentStack.length - 1];
                if (activeSwitch) {
                    activeSwitch.lastLineWasCaseLabel = false;
                }
            }
            else if (bracketStack.length > 0 && !trimmed.match(/^[)}\]>]/)) {
                const matchingParen = bracketStack[bracketStack.length - 1];
                if (matchingParen.char === '(') {
                    currentIndent = matchingParen.assignedIndent + 1;
                } else {
                    currentIndent = indentLevel;
                }
                if (activeSwitch) {
                    activeSwitch.lastLineWasCaseLabel = false;
                }
            }
            
            else if (trimmed.match(/^(&&|\|\|)/)) {
                currentIndent = indentLevel + 1;
                if (activeSwitch) {
                    activeSwitch.lastLineWasCaseLabel = false;
                }
            }
            
            else if (activeSwitch) {
                activeSwitch.lastLineWasCaseLabel = false;
            }

            if (expectSingleStatementIndent && 
                inMultiLineControlStatement && 
                !previousLineHadUnclosedBrackets &&
                currentIndent === indentLevel) {
                currentIndent = indentLevel + 1;
                expectSingleStatementIndent = false;
                inMultiLineControlStatement = false;
            }
            
            let spaces = indentString.repeat(currentIndent);
            
            if (stringContinuationColumn >= 0) {
                spaces = ' '.repeat(stringContinuationColumn);
                if (!trimmed.endsWith('+')) {
                    stringContinuationColumn = -1;
                }
            }

            let codepart = trimmed;
            let commentPart = '';
            const lineCommentIndex = this.findFirstLineCommentOutsideStrings(trimmed);
            if (lineCommentIndex >= 0) {
                codepart = trimmed.substring(0, lineCommentIndex).trim();
                commentPart = ' ' + trimmed.substring(lineCommentIndex);
            }
            
            let normalizedTrimmed = this.normalizeSpacing(codepart);
            
            const previousLine = i > 0 ? lines[i - 1].trim() : '';
            const previousHasTernary = previousLine.includes('?');
            const currentStartsWithColon = trimmed.startsWith(':');
            
            if (previousHasTernary && currentStartsWithColon && result.length > 0) {
                const prevFullLine = result[result.length - 1];
                const questionPos = prevFullLine.indexOf('?');
                if (questionPos >= 0) {
                    spaces = ' '.repeat(questionPos);
                }
            }
            
            const finalTrimmed = this.alignInlineComment(normalizedTrimmed, commentPart);

            const formattedLine = finalTrimmed ? spaces + finalTrimmed : '';

            let mergedWithPrevLine = false;
            if (trimmed === '{' && result.length > 0) {
                const prevLine = result[result.length - 1].trim();
                const isFunctionDeclaration = LPC_FUNCTION_DECLARATION_PATTERN.test(prevLine);
                const hasVarargs = /\bvarargs\s+/.test(prevLine);

                if (isFunctionDeclaration && !hasVarargs) {
                    result[result.length - 1] = result[result.length - 1] + ' {';
                    mergedWithPrevLine = true;
                }
            }
            
            if (!mergedWithPrevLine && trimmed.startsWith(',') && result.length > 0) {
                result[result.length - 1] = result[result.length - 1] + ',';
                const withoutLeadingComma = trimmed.substring(1).trim();
                const fixedLine = spaces + withoutLeadingComma;
                result.push(fixedLine);
            } else if (!mergedWithPrevLine) {
                result.push(formattedLine);
            }
            
            // Check if this line starts a backslash string continuation
            // This happens when a line ends with \ inside a string
            if (this.endsWithBackslashInString(trimmed)) {
                inBackslashStringContinuation = true;
            }
            
            const lineScanner = new CharacterScanner();

            for (let col = 0; col < formattedLine.length; col++) {
                const { skip, skipNext } = lineScanner.processChar(formattedLine, col);
                if (skipNext) col++;
                if (skip) continue;

                const char = formattedLine[col];
                const nextChar = col + 1 < formattedLine.length ? formattedLine[col + 1] : '';
                const prevChar = col > 0 ? formattedLine[col - 1] : '';

                if (char === '(' && (nextChar === '{' || nextChar === '[' || nextChar === '<')) {
                    const restOfLine = formattedLine.substring(col + 2);
                    const isCast = LPC_CAST_SUFFIX_PATTERN.test(restOfLine);
                    
                    if (isCast) {
                        bracketStack.push({ char: '(', assignedIndent: currentIndent });
                        col++;
                        continue;
                    }
                    
                    // For closure arrays ({, push the ( to track nesting depth
                    bracketStack.push({ char: '(', assignedIndent: currentIndent });
                    col++;  // Skip the {
                    continue;
                }
                
                if ((char === '}' || char === ']' || char === '>') && (nextChar === ')')) {
                    // For }), ]), >) LPC structure closers, pop the matching ( that was pushed
                    if (bracketStack.length > 0) {
                        const last = bracketStack[bracketStack.length - 1];
                        if (last.char === '(') {
                            bracketStack.pop();
                        }
                    }
                    col++;  // Skip the )
                    continue;
                }
                
                if (char === ')' && (prevChar === '}' || prevChar === ']' || prevChar === '>')) {
                    // Already handled above
                    continue;
                }
                
                if (char === '[' && col >= 2 && formattedLine[col - 1] === '\'' && formattedLine[col - 2] === '#') {
                    continue;
                }
                
                if (char === '(' || char === '[' || char === '{') {
                    bracketStack.push({ char, assignedIndent: currentIndent });
                } else if (char === ')' || char === ']' || char === '}') {
                    if (bracketStack.length > 0) {
                        const last = bracketStack[bracketStack.length - 1];
                        if ((char === ')' && last.char === '(') ||
                            (char === ']' && last.char === '[') ||
                            (char === '}' && last.char === '{')) {
                            bracketStack.pop();
                        }
                    }
                }
            }

            // Propagate block comment state when /* is opened mid-line without closing
            if (lineScanner.inBlockComment) {
                inBlockComment = true;
                blockCommentIndent = currentIndent;
            }

            if (trimmed.endsWith(';') || trimmed.match(/;\s*(\/\/|\/\*)/)) {
                bracketStack.length = 0;
                lpcStructureIndentStack.length = 0;
            }

            const trimmedWithoutComments = this.stripCommentsAndStrings(trimmed);
            if (!trimmedWithoutComments.endsWith('{') && this.isControlStatementWithoutBrace(trimmed)) {
                expectSingleStatementIndent = true;
                if (this.hasUnclosedBrackets(trimmed)) {
                    inMultiLineControlStatement = true;
                }
            }

            const { openBraceCount, closeBraceCount, openingCount, closingCount} = 
                this.countBracesAndStructures(trimmed, leadingCloseBraceHandled);
            const netLPCChange = openingCount - closingCount;
            
            const netBraces = openBraceCount - closeBraceCount;
            if (netBraces > 0) {
                indentLevel += netBraces;
                if (!inMultiLineControlStatement) {
                    expectSingleStatementIndent = false;
                }
            }
            
            if (openingCount > 0) {
                lpcDataStructureDepth += openingCount;
            }
            
            if (closingCount > 0) {
                lpcDataStructureDepth = Math.max(0, lpcDataStructureDepth - closingCount);
            }

            // Update previous line state AFTER updating lpcDataStructureDepth
            previousCurrentIndent = currentIndent;
            previousLineNeedsContinuation = this.needsContinuation(trimmed);
            previousLineHadUnclosedBrackets = this.hasUnclosedBrackets(trimmed);
            
            if (netLPCChange > 0) {
                const elementIndent = currentIndent + 1;
                for (let i = 0; i < netLPCChange; i++) {
                    lpcStructureIndentStack.push(elementIndent);
                }
            } else if (netLPCChange < 0) {
                for (let i = 0; i < Math.abs(netLPCChange); i++) {
                    if (lpcStructureIndentStack.length > 0) {
                        lpcStructureIndentStack.pop();
                    }
                }
            }
        }

        result = this.postProcessMultiLinePatterns(result);

        return result.join('\n');
    }

    private preprocessLines(lines: string[]): string[] {
        const preprocessedLines: string[] = [];
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                preprocessedLines.push(line);
                continue;
            }
            
            let codeOnly = trimmed;
            const commentPos = this.findFirstCommentOutsideStrings(trimmed);
            if (commentPos >= 0) {
                codeOnly = trimmed.substring(0, commentPos).trim();
            }
            
            const isOneLinerFunction = codeOnly.match(/^[a-zA-Z_][\w\s*]*\([^)]*\)\s*\{[^}]*\}\s*$/);
            const isOneLinerControl = (codeOnly.match(/^(if|while|for|foreach)\s*\(/) || codeOnly.match(/^else\s*(if\s*\(|{)/)) && codeOnly.includes('{') && codeOnly.includes('}');
            const isOneLinerIfElse = codeOnly.match(/^if\s*\([^)]*\)\s*\{[^}]*\}\s*else\s*\{[^}]*\}\s*$/);
            
            if (codeOnly.match(/;\s*\}+\s*$/) && !isOneLinerFunction && !isOneLinerControl && !isOneLinerIfElse) {
                const match = codeOnly.match(/^(.*?;\s*)(\}+)\s*$/);
                if (match) {
                    const leadingSpaces = line.match(/^(\s*)/)?.[1] || '';
                    preprocessedLines.push(leadingSpaces + match[1].trim());
                    preprocessedLines.push(leadingSpaces + match[2]);
                } else {
                    preprocessedLines.push(line);
                }
            } else {
                preprocessedLines.push(line);
            }
        }
        
        return preprocessedLines;
    }

    private handleSpecialLine(
        trimmed: string,
        indentLevel: number,
        state: {
            inBlockComment: boolean;
            blockCommentIndent: number;
            preprocessorIndentStack: number[];
        },
        indentString: string = '    '
    ): SpecialLineResult {
        if (!state.inBlockComment && trimmed.includes('/*')) {
            const startPos = trimmed.indexOf('/*');

            // Don't treat /* inside strings as block comments
            if (this.isInsideString(trimmed, startPos)) {
                return { handled: false };
            }

            // If there's code before /*, let the normal formatter handle the line;
            // the main loop will detect the unclosed block comment via character tracking
            if (startPos > 0) {
                return { handled: false };
            }

            const endPos = trimmed.indexOf('*/', startPos + 2);
            if (endPos === -1) {
                const spaces = indentString.repeat(indentLevel);
                const afterComment = trimmed.substring(startPos + 2).trim();

                if (afterComment.length > 0) {
                    return {
                        handled: true,
                        output: [spaces + '/*', spaces + ' * ' + afterComment],
                        inBlockComment: true,
                        blockCommentIndent: indentLevel
                    };
                } else {
                    return {
                        handled: true,
                        output: spaces + '/*',
                        inBlockComment: true,
                        blockCommentIndent: indentLevel
                    };
                }
            }
        }
        
        if (state.inBlockComment) {
            const spaces = indentString.repeat(state.blockCommentIndent);
            let formattedComment = trimmed;
            
            if (trimmed.startsWith('*') && !trimmed.startsWith('*/')) {
                formattedComment = ' * ';
                const textAfterAsterisk = trimmed.substring(1).trim();
                if (textAfterAsterisk.length > 0) {
                    formattedComment += textAfterAsterisk;
                }
            } else if (trimmed.startsWith('*/')) {
                formattedComment = ' */';
            } else if (trimmed.length > 0) {
                formattedComment = ' * ' + trimmed;
            }
            
            const isClosing = trimmed.includes('*/');
            return {
                handled: true,
                output: spaces + formattedComment,
                inBlockComment: !isClosing,
                resetFlags: isClosing
            };
        }
        
        if (trimmed.startsWith('//')) {
            const spaces = indentString.repeat(indentLevel);
            return {
                handled: true,
                output: spaces + trimmed,
                resetFlags: true
            };
        }
        
        if (!trimmed) {
            return {
                handled: true,
                output: '',
                resetFlags: true,
                clearBracketStack: true
            };
        }
        
        if (trimmed.startsWith('#') && !trimmed.startsWith("#'")) {
            let newIndentLevel: number | undefined;
            
            if (trimmed.match(/^#\s*if/)) {
                state.preprocessorIndentStack.push(indentLevel);
            } else if (trimmed.match(/^#\s*else/) || trimmed.match(/^#\s*elif/)) {
                if (state.preprocessorIndentStack.length > 0) {
                    newIndentLevel = state.preprocessorIndentStack[state.preprocessorIndentStack.length - 1];
                }
            } else if (trimmed.match(/^#\s*endif/)) {
                if (state.preprocessorIndentStack.length > 0) {
                    state.preprocessorIndentStack.pop();
                }
            }
            
            return {
                handled: true,
                output: trimmed,
                updateIndentLevel: newIndentLevel,
                resetFlags: true
            };
        }
        
        return { handled: false };
    }

    private normalizeSpacing(code: string): string {
        let normalized = this.replaceOutsideProtectedText(code, /,\s{2,}/g, ', ');
        
        // Remove extra spaces before closing parens, semicolons, braces
        normalized = this.replaceOutsideProtectedText(normalized, /\s{2,}([);{])/g, ' $1');
        normalized = this.replaceOutsideProtectedText(normalized, /\s+;/g, ';');
        
        const structuralCode = this.stripCommentsAndStrings(normalized);
        const hasMultipleClosingParens = structuralCode.includes('}));') ||
                                         /\}\)\s*\)\s*\)/.test(structuralCode) ||
                                         /\}\)\s*\)\s*;/.test(structuralCode);
        if (!hasMultipleClosingParens && (structuralCode.match(/\}\s*\)/g) || []).length < 2) {
            normalized = this.replaceOutsideProtectedText(normalized, /\}\)\s+\)/g, '})');
        }
        
        normalized = this.replaceOutsideProtectedText(normalized, /\(\s+(?!\(\{)/g, '(');
        
        normalized = this.replaceOutsideProtectedText(
            normalized,
            new RegExp(`\\b(${LPC_TYPE_PATTERN})\\s{2,}`, 'g'),
            '$1 '
        );
        
        normalized = this.replaceOutsideProtectedText(normalized, /\bcase\s{2,}/g, 'case ');
        normalized = this.replaceOutsideProtectedText(normalized, /\bcase\s+(.+?)\s+:/g, 'case $1:');
        
        normalized = this.replaceOutsideProtectedText(normalized, /([=!<>+\-*/%&|^])\s{2,}=/g, '$1=');
        normalized = this.replaceOutsideProtectedText(normalized, /=\s{2,}([=>])/g, '=$1');
        
        normalized = this.replaceOutsideProtectedText(normalized, /([^=!<>+\-*/%&|^'])\s*=\s*([^=])/g, '$1 = $2');
        
        normalized = this.replaceOutsideProtectedText(normalized, /#'\s*(\[\.{2}|\[|[?=!<>&|+\-*/%^~]+)\s*/g, "#'$1");
        
        normalized = this.replaceOutsideProtectedText(normalized, /\s{2,}\+/g, ' +');
        
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_")\]}])\+([a-zA-Z0-9_"({])/g, '$1 + $2');
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_")\]}]) \+([a-zA-Z0-9_"({])/g, '$1 + $2');
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_")\]}])\+ ([a-zA-Z0-9_"({])/g, '$1 + $2');
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_")\]}])-([a-zA-Z0-9_"({])/g, '$1 - $2');
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_)\]}])\/([a-zA-Z0-9_({])/g, '$1 / $2');
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_)\]}])%([a-zA-Z0-9_({])/g, '$1 % $2');
        
        normalized = this.replaceOutsideProtectedText(normalized, /,([a-zA-Z0-9_"'({])/g, ', $1');
        
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_")\]}])\+=([a-zA-Z0-9_"({])/g, '$1 += $2');
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_")\]}]) \+=([a-zA-Z0-9_"({])/g, '$1 += $2');
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_")\]}])\+= ([a-zA-Z0-9_"({])/g, '$1 += $2');
        
        normalized = this.replaceOutsideProtectedText(normalized, /\(:\s+/g, '(: ');
        normalized = this.replaceOutsideProtectedText(normalized, /\s+:\)/g, ' :)');
        normalized = this.replaceOutsideProtectedText(normalized, /\(:\s+(.+?)\s+:\)/g, (match, content) => {
            const contentNormalized = content.replace(/\s{2,}/g, ' ');
            return `(: ${contentNormalized} :)`;
        });
        
        return normalized;
    }

    private alignInlineComment(normalizedCode: string, commentPart: string): string {
        if (!commentPart) {
            return normalizedCode;
        }
        
        const trimmedCode = normalizedCode.trim();
        const codeLength = trimmedCode.length;
        
        if (trimmedCode.endsWith('{')) {
            return normalizedCode + ' ' + commentPart.trim();
        }
        
        const indent = normalizedCode.length - codeLength;
        const minSpacing = 2;
        const targetColumn = Math.ceil((codeLength + minSpacing) / 4) * 4;
        const targetPosition = indent + targetColumn;
        const spacesNeeded = Math.max(minSpacing, targetPosition - normalizedCode.length);
        
        return normalizedCode + ' '.repeat(spacesNeeded) + commentPart.trim();
    }

    private countBracesAndStructures(trimmed: string, leadingCloseBraceHandled: boolean): {
        openBraceCount: number;
        closeBraceCount: number;
        openingCount: number;
        closingCount: number;
    } {
        let openBraceCount = 0;
        let closeBraceCount = 0;
        let openingCount = 0;
        let closingCount = 0;
        const scanner = new CharacterScanner();

        for (let i = 0; i < trimmed.length; i++) {
            const { skip, skipNext } = scanner.processChar(trimmed, i);
            if (skipNext) i++;
            if (skip) continue;

            const char = trimmed[i];
            const nextChar = i + 1 < trimmed.length ? trimmed[i + 1] : '';
            const prevChar = i > 0 ? trimmed[i - 1] : '';

            // LPC structure openers: ({, ([, (<
            if (char === '(' && (nextChar === '{' || nextChar === '[' || nextChar === '<')) {
                openingCount++;
                i++;  // Skip the {/[/<
                continue;
            }

            // LPC structure closers: }), ]), >)
            if ((char === '}' || char === ']' || char === '>') && nextChar === ')') {
                closingCount++;
                i++;  // Skip the )
                continue;
            }

            // Skip ) that was part of a structure closer already handled
            if (char === ')' && (prevChar === '}' || prevChar === ']' || prevChar === '>')) {
                continue;
            }

            // Regular braces
            if (char === '{') {
                if (prevChar !== '(' && prevChar !== '[' && prevChar !== '<') {
                    openBraceCount++;
                }
            } else if (char === '}') {
                if (i === 0 && leadingCloseBraceHandled) {
                    continue;
                }
                closeBraceCount++;
            }
        }

        return { openBraceCount, closeBraceCount, openingCount, closingCount };
    }

    private isInsideString(line: string, position: number): boolean {
        const scanner = new CharacterScanner();
        for (let i = 0; i < position; i++) {
            const { skipNext } = scanner.processChar(line, i);
            if (skipNext) {
                i++;
            }
        }

        return scanner.inString;
    }

    private findFirstCommentOutsideStrings(line: string): number {
        return this.findFirstComment(line, false);
    }

    private findFirstLineCommentOutsideStrings(line: string): number {
        return this.findFirstComment(line, true);
    }

    private findFirstComment(line: string, lineCommentsOnly: boolean): number {
        const scanner = new CharacterScanner();
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = i + 1 < line.length ? line[i + 1] : '';

            if (!scanner.inString && !scanner.inLineComment && !scanner.inBlockComment
                && char === '/' && (nextChar === '/' || (!lineCommentsOnly && nextChar === '*'))) {
                return i;
            }

            const { skipNext } = scanner.processChar(line, i);
            if (skipNext) {
                i++;
            }
        }

        return -1;
    }

    private endsWithBackslashInString(line: string): boolean {
        // Check if the line ends with a backslash and we're inside a string
        const trimmedLine = line.trimEnd();
        if (!trimmedLine.endsWith('\\')) {
            return false;
        }
        
        // Walk through the line to determine if we're in a string at the end
        let inString = false;
        let escaped = false;
        
        for (let i = 0; i < trimmedLine.length; i++) {
            const char = trimmedLine[i];
            
            if (escaped) {
                escaped = false;
                // If this is the last char and it's a backslash, we're continuing the string
                if (i === trimmedLine.length - 1 && char === '\\' && inString) {
                    return true;
                }
                continue;
            }
            
            if (char === '\\') {
                escaped = true;
                // Check if this is the last character
                if (i === trimmedLine.length - 1 && inString) {
                    return true;
                }
                continue;
            }
            
            if (char === '"') {
                inString = !inString;
            }
        }
        
        return false;
    }

    private computeProtectedMask(line: string): boolean[] {
        const mask = new Array<boolean>(line.length).fill(false);
        const scanner = new CharacterScanner();
        for (let i = 0; i < line.length; i++) {
            const { skip, skipNext } = scanner.processChar(line, i);
            if (skip) {
                mask[i] = true;
            }
            if (skipNext && i + 1 < line.length) {
                mask[i + 1] = true;
                i++;
            }
        }

        return mask;
    }

    private rangeTouchesProtectedText(mask: boolean[], start: number, length: number): boolean {
        for (let i = start; i < start + length; i++) {
            if (mask[i]) {
                return true;
            }
        }
        return false;
    }

    private replaceOutsideProtectedText(line: string, pattern: RegExp, replacement: string | ((...args: string[]) => string)): string {
        let result = '';
        let lastIndex = 0;

        const matches: Array<{index: number, match: RegExpExecArray}> = [];
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(line)) !== null) {
            matches.push({index: match.index, match});
        }

        if (matches.length === 0) {
            return line;
        }

        const mask = this.computeProtectedMask(line);

        for (const {index, match} of matches) {
            result += line.substring(lastIndex, index);

            if (!this.rangeTouchesProtectedText(mask, index, match[0].length)) {
                if (typeof replacement === 'function') {
                    result += replacement(match[0], ...match.slice(1));
                } else {
                    result += match[0].replace(pattern, replacement);
                }
            } else {
                result += match[0];
            }
            lastIndex = index + match[0].length;
        }

        result += line.substring(lastIndex);
        return result;
    }

    private postProcessMultiLinePatterns(lines: string[]): string[] {
        const processed: string[] = [];
        let insideLambda = 0;
        const isClosureContent = (content: string): boolean => {
            const trimmedContent = content.trim();
            if (trimmedContent.includes("#'") || trimmedContent.match(/'\w+/) || trimmedContent.includes('lambda')) {
                return true;
            }
            return false;
        };
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let analysisLine = this.stripCommentsAndStrings(line);
            let trimmed = analysisLine.trim();
            
            if (trimmed.includes('lambda(')) {
                insideLambda++;
            }
            
            if (i > 0) {
                const prevIdx = processed.length - 1;
                const prevLine = processed[prevIdx];
                const previousAnalysis = this.stripCommentsAndStrings(prevLine);
                const prevTrimmed = previousAnalysis.trim();

                if (prevTrimmed.endsWith(',') && (trimmed === '])' || trimmed === '})' || trimmed.startsWith('])') || trimmed.startsWith('})'))) {
                    const commaIndex = previousAnalysis.lastIndexOf(',');
                    processed[prevIdx] = prevLine.substring(0, commaIndex) + prevLine.substring(commaIndex + 1);
                }
            }

            const lambdaEndPattern = trimmed.match(/\)\s*\)\s*;?\s*$/);

            if (insideLambda > 0) {
                processed.push(line);
                if (lambdaEndPattern) {
                    insideLambda--;
                }
                continue;
            }

            const typedClosureMask = this.computeProtectedMask(line);
            line = line.replace(new RegExp(`\\(\\{\\s*(${LPC_TYPE_PATTERN})(\\*?)\\s*\\}\\)`, 'g'), (match, type, star, offset) => {
                return this.rangeTouchesProtectedText(typedClosureMask, offset, match.length)
                    ? match
                    : `({${type}${star}})`;
            });

            analysisLine = this.stripCommentsAndStrings(line);
            trimmed = analysisLine.trim();
            const protectedMask = this.computeProtectedMask(line);
            const closureEndCount = (analysisLine.match(/\}\s*\)/g) || []).length;
            const hasMultipleClosures = closureEndCount >= 2;
            const hasClosureIndicators = analysisLine.includes('#\'') || trimmed.startsWith('({#\'');
            const hasDoubleClosingParens = analysisLine.includes('}));');

            if (hasMultipleClosures || hasClosureIndicators || hasDoubleClosingParens) {
                processed.push(line);
            } else {
                let processedLine = '';
                let lastIndex = 0;
                const regex = /\(\{\s*([^}]*?)\s*\}\)/g;
                let match;
                
                while ((match = regex.exec(line)) !== null) {
                    if (this.rangeTouchesProtectedText(protectedMask, match.index, match[0].length)) {
                        continue;
                    }
                    
                    const fullMatch = match[0];
                    const content = match[1];
                    const trimmedContent = content.trim();
                    
                    if (trimmedContent.length === 0 || 
                        LPC_TYPE_WITH_OPTIONAL_POINTER_PATTERN.test(trimmedContent)) {
                        processedLine += line.substring(lastIndex, match.index + fullMatch.length);
                        lastIndex = match.index + fullMatch.length;
                        continue;
                    }
                    
                    const isClosure = isClosureContent(trimmedContent);
                    
                    processedLine += line.substring(lastIndex, match.index);
                    
                    if (isClosure) {
                        const needsSpaceAfter = trimmedContent.startsWith('/*');
                        let result = needsSpaceAfter ? `({ ${trimmedContent}` : `({${trimmedContent}`;
                        if (result.endsWith(' ')) {
                            result = result.slice(0, -1);
                        }
                        processedLine += result + '})';
                    } else {
                        processedLine += `({ ${trimmedContent} })`;
                    }
                    
                    lastIndex = match.index + fullMatch.length;
                }
                
                processedLine += line.substring(lastIndex);
                processed.push(processedLine);
            }
        }
        
        return processed;
    }

    private needsContinuation(line: string): boolean {
        const trimmedLine = this.stripCommentsAndStrings(line).trimEnd();
        
        if (trimmedLine.endsWith('{')) {
            return false;
        }
        
        if (trimmedLine.endsWith(';')) {
            return false;
        }
        
        if (this.hasUnclosedBrackets(trimmedLine)) {
            return true;
        }
        
        if (trimmedLine.match(/(\|\||&&)\s*$/)) {
            return true;
        }
        
        if (trimmedLine.match(/[+\-*/%]\s*$/) && !trimmedLine.match(/^\s*(case\s+|default\s*:)/)) {
            return true;
        }
        
        if (trimmedLine.endsWith(',')) {
            return true;
        }
        
        return false;
    }

    private hasUnclosedBrackets(line: string): boolean {
        let parens = 0, brackets = 0, braces = 0;
        const scanner = new CharacterScanner();
        
        for (let i = 0; i < line.length; i++) {
            const { skip, skipNext } = scanner.processChar(line, i);
            if (skipNext) {
                i++;
            }
            if (skip) {
                continue;
            }

            const char = line[i];

            // Skip LPC function references like #'[ - the [ is not an actual bracket
            if (char === '[' && i >= 2 && line[i - 1] === '\'' && line[i - 2] === '#') {
                continue;
            }

            switch (char) {
                case '(': parens++; break;
                case ')': parens--; break;
                case '[': brackets++; break;
                case ']': brackets--; break;
                case '{': braces++; break;
                case '}': braces--; break;
            }
        }
        
        return parens > 0 || brackets > 0 || braces > 0;
    }

    private stripCommentsAndStrings(line: string): string {
        let result = '';
        const scanner = new CharacterScanner();

        for (let i = 0; i < line.length; i++) {
            const { skip, skipNext } = scanner.processChar(line, i);

            if (skipNext) {
                result += '  ';
                i++;
                continue;
            }
            if (skip) {
                result += line[i] === '"' ? '"' : ' ';
                continue;
            }
            result += line[i];
        }

        return result.trimEnd();
    }

    private isControlStatementWithoutBrace(line: string): boolean {
        // Strip comments to check the actual code structure
        const withoutComments = this.stripCommentsAndStrings(line);
        
        if (line.match(/^\s*(?:if|while|for|foreach)\s*\(/)) {
            if (withoutComments.trimEnd().endsWith(')')) {
                return true;
            }
            if (this.hasUnclosedBrackets(withoutComments)) {
                return true;
            }
        }
        
        if (line.match(/^\s*else\s*$/)) {
            return true;
        }
        
        if (line.match(/^\s*else\s+if\s*\(/) && withoutComments.trimEnd().endsWith(')')) {
            return true;
        }
        
        if (line.match(/^\s*do\s*$/)) {
            return true;
        }
        
        return false;
    }
}