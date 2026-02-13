import * as vscode from 'vscode';

interface BracketInfo {
    char: string;
    column: number;
    lineIndex: number;
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

class CharacterScanner {
    inString = false;
    inLineComment = false;
    inBlockComment = false;

    /** Process one character, updating state. */
    processChar(line: string, index: number): { skip: boolean; skipNext: boolean } {
        const char = line[index];
        const nextChar = index + 1 < line.length ? line[index + 1] : '';

        // Handle string toggle (double quotes only, with backslash-escape counting)
        if (char === '"' && !this.inLineComment && !this.inBlockComment) {
            let backslashCount = 0;
            let j = index - 1;
            while (j >= 0 && line[j] === '\\') {
                backslashCount++;
                j--;
            }
            if (backslashCount % 2 === 0) {
                this.inString = !this.inString;
            }
            return { skip: true, skipNext: false };
        }

        if (this.inString) {
            return { skip: true, skipNext: false };
        }

        // Line comment start
        if (!this.inBlockComment && char === '/' && nextChar === '/') {
            this.inLineComment = true;
            return { skip: true, skipNext: false };
        }

        if (this.inLineComment) {
            return { skip: true, skipNext: false };
        }

        // Block comment start
        if (char === '/' && nextChar === '*') {
            this.inBlockComment = true;
            return { skip: true, skipNext: true };
        }

        // Block comment end
        if (this.inBlockComment && char === '*' && nextChar === '/') {
            this.inBlockComment = false;
            return { skip: true, skipNext: true };
        }

        if (this.inBlockComment) {
            return { skip: true, skipNext: false };
        }

        return { skip: false, skipNext: false };
    }

    resetForNewLine(): void {
        this.inLineComment = false;
    }

    reset(): void {
        this.inString = false;
        this.inLineComment = false;
        this.inBlockComment = false;
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

        try {
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length)
            );
            const text = document.getText(fullRange);
            const indentSize = config.get<number>('indentSize', options.tabSize);
            let formattedText = this.formatLPCCode(text, options, indentSize, token);

            if (config.get<boolean>('insertFinalNewline', true) && !formattedText.endsWith('\n')) {
                formattedText += '\n';
            }

            if (formattedText === text) {
                return [];
            }

            return [vscode.TextEdit.replace(fullRange, formattedText)];
        } catch (error) {
            console.error('LPC Formatting Error:', error);
            return [];
        }
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

        try {
            const text = document.getText(range);
            const indentSize = config.get<number>('indentSize', options.tabSize);
            const formattedText = this.formatLPCCode(text, options, indentSize, token);
            
            if (formattedText === text) {
                return [];
            }
            
            return [vscode.TextEdit.replace(range, formattedText)];
        } catch (error) {
            console.error('LPC Formatting Error:', error);
            return [];
        }
    }

    private formatLPCCode(code: string, options: vscode.FormattingOptions, indentSize: number, token?: vscode.CancellationToken): string {
        const indentString = options.insertSpaces
            ? ' '.repeat(indentSize)
            : '\t';
        
        let lines = this.preprocessLines(code.split(/\r?\n/));
        
        let result: string[] = [];
        let indentLevel = 0;
        let inSwitch = false;
        let switchIndentLevel = 0;
        let lastLineWasCaseLabel = false;
        let inCaseBody = false;
        let previousLineNeedsContinuation = false;
        let previousCurrentIndent = 0;
        let previousLineHadUnclosedBrackets = false;
        let inMultiLineControlStatement = false;
        let stringContinuationColumn = -1;
        let customSpacing: string | null = null;
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
                    lastLineWasCaseLabel = false;
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
                if (trimmed === '}' && inSwitch && indentLevel < switchIndentLevel) {
                    inSwitch = false;
                    switchIndentLevel = 0;
                    lastLineWasCaseLabel = false;
                    inCaseBody = false;
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
                inSwitch = true;
                switchIndentLevel = indentLevel;
            }
            
            if (trimmed.match(/^(case\s+.*:|default\s*:)/)) {
                currentIndent = switchIndentLevel;
                lastLineWasCaseLabel = true;
                inCaseBody = true;
            }
            else if (inSwitch && trimmed === 'break;') {
                currentIndent = indentLevel;
                inCaseBody = false;
            }
            else if (inSwitch && inCaseBody && !trimmed.match(/^(case\s+|default\s*:)/) && !expectSingleStatementIndent) {
                currentIndent = indentLevel;
                lastLineWasCaseLabel = false;
            }
            else if (inSwitch && lastLineWasCaseLabel && !trimmed.match(/^(case\s+|default\s*:)/) && !expectSingleStatementIndent) {
                if (!trimmed.startsWith('//')) {
                    currentIndent = indentLevel;
                    lastLineWasCaseLabel = false;
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
                lastLineWasCaseLabel = false;
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
                lastLineWasCaseLabel = false;
            }
            else if (previousLineNeedsContinuation && bracketStack.length > 0 && bracketStack[bracketStack.length - 1].char === '(' && !trimmed.match(/^[)}\]>]/)) {
                // Use continuation indent for function arguments (base indent + 1)
                const parenMatch = bracketStack[bracketStack.length - 1];
                currentIndent = parenMatch.assignedIndent + 1;
                lastLineWasCaseLabel = false;
            }
            else if (trimmed.match(/^(&&|\|\|)/) && lpcDataStructureDepth === 0) {
                currentIndent = Math.max(indentLevel + 1, previousCurrentIndent);
                lastLineWasCaseLabel = false;
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
                lastLineWasCaseLabel = false;
            }
            else if (lpcStructureIndentStack.length > 0 && !trimmed.match(/^[}\]>]\s*\)/) && trimmed !== ')') {
                currentIndent = lpcStructureIndentStack[lpcStructureIndentStack.length - 1];
                lastLineWasCaseLabel = false;
            }
            else if (bracketStack.length > 0 && !trimmed.match(/^[)}\]>]/)) {
                const matchingParen = bracketStack[bracketStack.length - 1];
                if (matchingParen.char === '(') {
                    currentIndent = matchingParen.assignedIndent + 1;
                } else {
                    currentIndent = indentLevel;
                }
                lastLineWasCaseLabel = false;
            }
            
            else if (trimmed.match(/^(&&|\|\|)/)) {
                currentIndent = indentLevel + 1;
                lastLineWasCaseLabel = false;
            }
            
            else {
                lastLineWasCaseLabel = false;
            }

            if (expectSingleStatementIndent && 
                inMultiLineControlStatement && 
                !previousLineHadUnclosedBrackets &&
                currentIndent === indentLevel) {
                currentIndent = indentLevel + 1;
                expectSingleStatementIndent = false;
                inMultiLineControlStatement = false;
            }
            
            let spaces = customSpacing !== null ? customSpacing : indentString.repeat(currentIndent);
            customSpacing = null;  // Reset for next line
            
            if (stringContinuationColumn >= 0) {
                spaces = ' '.repeat(stringContinuationColumn);
                if (!trimmed.endsWith('+')) {
                    stringContinuationColumn = -1;
                }
            }
            
            let codepart = trimmed;
            let commentPart = '';
            let inString = false;
            let lineCommentIndex = -1;
            for (let i = 0; i < trimmed.length; i++) {
                if (trimmed[i] === '"') {
                    let backslashCount = 0;
                    let j = i - 1;
                    while (j >= 0 && trimmed[j] === '\\') {
                        backslashCount++;
                        j--;
                    }
                    if (backslashCount % 2 === 0) {
                        inString = !inString;
                    }
                }
                if (!inString && trimmed[i] === '/' && i + 1 < trimmed.length && trimmed[i + 1] === '/') {
                    lineCommentIndex = i;
                    break;
                }
            }
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
                const isFunctionDecl = prevLine.match(/^(static\s+|private\s+|protected\s+|public\s+|nomask\s+|deprecated\s+)*(void|int|string|object|mixed|float|status|mapping|closure|symbol|bytes|struct|lwobject|coroutine|lpctype)\s*\**\s+\w+\s*\([^)]*\)\s*$/);
                const isControlFlow = prevLine.match(/^\s*(if|while|for|foreach|do|switch|catch|else\s+if)\s*\(/);
                const hasVarargs = prevLine.match(/\bvarargs\s+/);
                const hasIntermediateLines = prevLine !== '' && !isFunctionDecl;
                
                if (isFunctionDecl && !isControlFlow && !hasVarargs && !hasIntermediateLines) {
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
                    const isCast = restOfLine.match(/^(int|string|object|float|mixed|mapping|status|closure|symbol|void|bytes|struct|lwobject|coroutine)\s*\)/);
                    
                    if (isCast) {
                        bracketStack.push({ char: '(', column: col, lineIndex: i, assignedIndent: currentIndent });
                        col++;
                        continue;
                    }
                    
                    // For closure arrays ({, push the ( to track nesting depth
                    bracketStack.push({ char: '(', column: col, lineIndex: i, assignedIndent: currentIndent });
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
                    bracketStack.push({ char, column: col, lineIndex: i, assignedIndent: currentIndent });
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
            
            if (inSwitch && switchIndentLevel === indentLevel && trimmed.includes('switch(') && trimmed.endsWith('{')) {
                indentLevel++;
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
        let normalized = code.replace(/,\s{2,}/g, ', ');
        
        // Remove extra spaces before closing parens, semicolons, braces
        normalized = this.replaceOutsideStrings(normalized, /\s{2,}([);{])/g, ' $1');
        normalized = this.replaceOutsideStrings(normalized, /\s+;/g, ';');
        
        const hasMultipleClosingParens = normalized.includes('}));') || 
                                         /\}\)\s*\)\s*\)/.test(normalized) ||
                                         /\}\)\s*\)\s*;/.test(normalized);
        if (!hasMultipleClosingParens && (normalized.match(/\}\s*\)/g) || []).length < 2) {
            normalized = this.replaceOutsideStrings(normalized, /\}\)\s+\)/g, '})');
        }
        
        normalized = this.replaceOutsideStrings(normalized, /\(\s+(?!\(\{)/g, '(');
        
        normalized = this.replaceOutsideStrings(normalized, /\b(int|string|object|float|mixed|mapping|status|closure|symbol|void|bytes|struct|lwobject|coroutine)\s{2,}/g, '$1 ');
        
        normalized = this.replaceOutsideStrings(normalized, /\bcase\s{2,}/g, 'case ');
        normalized = this.replaceOutsideStrings(normalized, /\bcase\s+(.+?)\s+:/g, 'case $1:');
        
        normalized = this.replaceOutsideStrings(normalized, /([=!<>+\-*/%&|^])\s{2,}=/g, '$1=');
        normalized = this.replaceOutsideStrings(normalized, /=\s{2,}([=>])/g, '=$1');
        
        normalized = this.replaceOutsideStrings(normalized, /([^=!<>+\-*/%&|^'])\s*=\s*([^=])/g, '$1 = $2');
        
        normalized = this.replaceOutsideStrings(normalized, /#'\s*([=!<>&|+\-*/%^]+)\s*/g, "#'$1");
        
        normalized = this.replaceOutsideStrings(normalized, /\s{2,}\+/g, ' +');
        
        normalized = this.replaceOutsideStrings(normalized, /([a-zA-Z0-9_")\]}])\+([a-zA-Z0-9_"({])/g, '$1 + $2');
        normalized = this.replaceOutsideStrings(normalized, /([a-zA-Z0-9_")\]}]) \+([a-zA-Z0-9_"({])/g, '$1 + $2');
        normalized = this.replaceOutsideStrings(normalized, /([a-zA-Z0-9_")\]}])\+ ([a-zA-Z0-9_"({])/g, '$1 + $2');
        normalized = this.replaceOutsideStrings(normalized, /([a-zA-Z0-9_")\]}])-([a-zA-Z0-9_"({])/g, '$1 - $2');
        normalized = this.replaceOutsideStrings(normalized, /([a-zA-Z0-9_)\]}])\/([a-zA-Z0-9_({])/g, '$1 / $2');
        normalized = this.replaceOutsideStrings(normalized, /([a-zA-Z0-9_)\]}])%([a-zA-Z0-9_({])/g, '$1 % $2');
        
        normalized = this.replaceOutsideStrings(normalized, /,([a-zA-Z0-9_"'({])/g, ', $1');
        
        normalized = this.replaceOutsideStrings(normalized, /([a-zA-Z0-9_")\]}])\+=([a-zA-Z0-9_"({])/g, '$1 += $2');
        normalized = this.replaceOutsideStrings(normalized, /([a-zA-Z0-9_")\]}]) \+=([a-zA-Z0-9_"({])/g, '$1 += $2');
        normalized = this.replaceOutsideStrings(normalized, /([a-zA-Z0-9_")\]}])\+= ([a-zA-Z0-9_"({])/g, '$1 += $2');
        
        normalized = this.replaceOutsideStrings(normalized, /\(:\s+/g, '(: ');
        normalized = this.replaceOutsideStrings(normalized, /\s+:\)/g, ' :)');
        normalized = this.replaceOutsideStrings(normalized, /\(:\s+(.+?)\s+:\)/g, (match, content) => {
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
        let inString = false;
        let stringChar = '';
        let escaped = false;
        
        for (let i = 0; i < position; i++) {
            const char = line[i];
            
            if (escaped) {
                escaped = false;
                continue;
            }
            
            if (char === '\\') {
                escaped = true;
                continue;
            }
            
            if ((char === '"' || char === "'") && !inString) {
                inString = true;
                stringChar = char;
            } else if (char === stringChar && inString) {
                inString = false;
                stringChar = '';
            }
        }
        
        return inString;
    }

    private findFirstCommentOutsideStrings(line: string): number {
        let inString = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                let backslashCount = 0;
                let j = i - 1;
                while (j >= 0 && line[j] === '\\') {
                    backslashCount++;
                    j--;
                }
                if (backslashCount % 2 === 0) {
                    inString = !inString;
                }
                continue;
            }

            if (inString) continue;

            if (char === '/' && i + 1 < line.length && (line[i + 1] === '/' || line[i + 1] === '*')) {
                return i;
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

    private computeStringMask(line: string): boolean[] {
        const mask = new Array<boolean>(line.length);
        let inString = false;
        let stringChar = '';
        let escaped = false;

        for (let i = 0; i < line.length; i++) {
            mask[i] = inString;

            const char = line[i];

            if (escaped) {
                escaped = false;
                continue;
            }

            if (char === '\\') {
                escaped = true;
                continue;
            }

            if ((char === '"' || char === "'") && !inString) {
                inString = true;
                stringChar = char;
            } else if (char === stringChar && inString) {
                inString = false;
                stringChar = '';
            }
        }

        return mask;
    }

    private replaceOutsideStrings(line: string, pattern: RegExp, replacement: string | ((...args: string[]) => string)): string {
        let result = '';
        let lastIndex = 0;

        const matches: Array<{index: number, match: RegExpExecArray}> = [];
        let match;
        while ((match = pattern.exec(line)) !== null) {
            matches.push({index: match.index, match});
        }

        if (matches.length === 0) {
            return line;
        }

        const mask = this.computeStringMask(line);

        for (const {index, match} of matches) {
            result += line.substring(lastIndex, index);

            let insideString = false;
            for (let i = 0; i < match[0].length; i++) {
                if (mask[index + i]) {
                    insideString = true;
                    break;
                }
            }

            if (!insideString) {
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
        return result || line;
    }

    private postProcessMultiLinePatterns(lines: string[]): string[] {
        const processed: string[] = [];
        let insideLambda = 0; // Track nesting depth of lambda expressions
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            const trimmed = line.trim();
            
            // Track lambda expression boundaries BEFORE processing the line
            if (trimmed.includes('lambda(')) {
                insideLambda++;
            }
            
            // Only handle the specific pattern: remove trailing comma before closing brackets
            if (i > 0) {
                const prevIdx = processed.length - 1;
                const prevLine = processed[prevIdx];
                const prevTrimmed = prevLine.trim();
                
                // Check if current line is a closing bracket and previous ends with comma
                if (prevTrimmed.endsWith(',') && (trimmed === '])' || trimmed === '})' || trimmed.startsWith('])') || trimmed.startsWith('})'))) {
                    // Remove trailing comma from previous line
                    processed[prevIdx] = prevLine.substring(0, prevLine.lastIndexOf(','));
                }
            }
            
            const isClosureContent = (content: string): boolean => {
                const trimmed = content.trim();
                if (trimmed.includes("#'")) {
                    return true;
                }
                if (trimmed.match(/'\w+/)) {
                    return true;
                }
                if (trimmed.includes('lambda')) {
                    return true;
                }
                if (trimmed.length === 0 || trimmed.match(/^[\d\w\s,"]+$/)) {
                    return false;
                }
                return false;
            };
            
            const lambdaEndPattern = trimmed.match(/\)\s*\)\s*;?\s*$/);
            
            if (insideLambda > 0) {
                processed.push(line);
                if (lambdaEndPattern) {
                    insideLambda--;
                }
                continue;
            }
            
            line = line.replace(/\(\{\s*(int|string|object|float|mixed|mapping|status|closure|symbol|void|bytes|struct|lwobject|coroutine)(\*?)\s*\}\)/g, (match, type, star, offset) => {
                return this.isInsideString(line, offset) ? match : `({${type}${star}})`;
            });
            
            const closureEndCount = (line.match(/\}\s*\)/g) || []).length;
            const hasMultipleClosures = closureEndCount >= 2;
            const hasClosureIndicators = line.includes('#\'') || trimmed.startsWith('({#\'');
            const hasDoubleClosingParens = line.includes('}));');
            
            if (hasMultipleClosures || hasClosureIndicators || hasDoubleClosingParens) {
                processed.push(line);
            } else {
                let processedLine = '';
                let lastIndex = 0;
                const regex = /\(\{\s*([^}]*?)\s*\}\)/g;
                let match;
                
                while ((match = regex.exec(line)) !== null) {
                    if (this.isInsideString(line, match.index)) {
                        continue;
                    }
                    
                    const fullMatch = match[0];
                    const content = match[1];
                    const trimmedContent = content.trim();
                    
                    if (trimmedContent.length === 0 || 
                        trimmedContent.match(/^(int|string|object|float|mixed|mapping|status|closure|symbol|void|bytes|struct|lwobject|coroutine)\*?$/)) {
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
        const withoutComment = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//, '');
        const trimmedLine = withoutComment.trimEnd();
        
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
        
        // For comma: check if it's outside local structures on this line
        // E.g., "({...})," has balanced structures, comma is outside, needs continuation
        // But "({..." has unclosed structure, already handled above
        if (trimmedLine.endsWith(',')) {
            // Check if all structures on this line are balanced
            if (!this.hasUnclosedBrackets(trimmedLine)) {
                return true;  // Comma outside structures
            }
            // If unclosed brackets, we already returned true above
        }
        
        return false;
    }

    private hasUnclosedBrackets(line: string): boolean {
        let parens = 0, brackets = 0, braces = 0;
        let inString = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            // Track string boundaries (handle escaped quotes)
            if (char === '"') {
                // Count preceding backslashes
                let backslashCount = 0;
                let j = i - 1;
                while (j >= 0 && line[j] === '\\') {
                    backslashCount++;
                    j--;
                }
                // If even number of backslashes (or zero), the quote is not escaped
                if (backslashCount % 2 === 0) {
                    inString = !inString;
                }
                continue;
            }
            
            // Skip bracket counting inside strings
            if (inString) {
                continue;
            }

            // Skip LPC function references like #'[ - the [ is not an actual bracket
            if (char === '[' && i >= 2 && line[i - 1] === '\'' && line[i - 2] === '#') {
                continue;
            }

            // Count brackets only outside strings
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