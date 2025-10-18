import * as vscode from 'vscode';

export class LPCDocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
    
    public provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        
        return this.provideDocumentRangeFormattingEdits(document, fullRange, options, token);
    }

    public provideDocumentRangeFormattingEdits(
        document: vscode.TextDocument,
        range: vscode.Range,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        try {
            const text = document.getText(range);
            const formattedText = this.formatLPCCode(text, options);
            
            if (formattedText === text) {
                return [];
            }
            
            return [vscode.TextEdit.replace(range, formattedText)];
        } catch (error) {
            console.error('LPC Formatting Error:', error);
            return [];
        }
    }

    private formatLPCCode(code: string, options: vscode.FormattingOptions): string {
        const lines = code.split(/\r?\n/);
        const result: string[] = [];
        let indentLevel = 0;
        let inSwitch = false;
        let switchIndentLevel = 0;
        let lastLineWasCaseLabel = false;
        let inCaseBody = false;
        let previousLineNeedsContinuation = false;
        let previousLineWasFunctionCall = false;
        let previousCurrentIndent = 0;
        let lpcStructureIndentStack: number[] = [];
        let inBlockComment = false;
        let blockCommentIndent = 0;
        let expectSingleStatementIndent = false;
        let lpcDataStructureDepth = 0;
        const bracketStack: Array<{ char: string; column: number; lineIndex: number }> = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            
            if (!inBlockComment && trimmed.includes('/*')) {
                // Check if it's an inline comment (both /* and */ on same line)
                const startPos = trimmed.indexOf('/*');
                const endPos = trimmed.indexOf('*/', startPos);
                if (endPos === -1) {
                    // Multi-line block comment starts
                    inBlockComment = true;
                    blockCommentIndent = indentLevel;
                    const spaces = '    '.repeat(blockCommentIndent);
                    
                    // Check if opening line has text after /*
                    const afterComment = trimmed.substring(startPos + 2).trim();
                    if (afterComment.length > 0) {
                        // Normalize: split "/* text" into "/*" and " * text"
                        result.push(spaces + '/*');
                        result.push(spaces + ' * ' + afterComment);
                        continue;
                    } else {
                        // Opening "/*" alone - just push it
                        result.push(spaces + '/*');
                        continue;
                    }
                }
            }
            
            if (inBlockComment) {
                const spaces = '    '.repeat(blockCommentIndent);
                // Always use aligned asterisk format: " * text"
                let formattedComment = trimmed;
                
                if (trimmed.startsWith('*') && !trimmed.startsWith('*/')) {
                    // Continuation line: ensure " * text" format
                    formattedComment = ' * ';
                    const textAfterAsterisk = trimmed.substring(1).trim();
                    if (textAfterAsterisk.length > 0) {
                        formattedComment += textAfterAsterisk;
                    }
                } else if (trimmed.startsWith('*/')) {
                    // Closing line: " */"
                    formattedComment = ' */';
                } else if (trimmed.length > 0) {
                    // Line without asterisk - treat as continuation text
                    formattedComment = ' * ' + trimmed;
                }
                
                result.push(spaces + formattedComment);
                
                if (trimmed.includes('*/')) {
                    inBlockComment = false;
                    previousLineNeedsContinuation = false;
                    expectSingleStatementIndent = false;
                    lastLineWasCaseLabel = false;
                }
                continue;
            }
            
            if (trimmed.startsWith('//')) {
                const spaces = '    '.repeat(indentLevel);
                result.push(spaces + trimmed);
                previousLineNeedsContinuation = false;
                expectSingleStatementIndent = false;
                lastLineWasCaseLabel = false;
                continue;
            }
            
            if (!trimmed) {
                result.push('');
                previousLineNeedsContinuation = false;
                bracketStack.length = 0; 
                continue;
            }

            if (trimmed.startsWith('#') && !trimmed.startsWith("#'")) {
                result.push(trimmed);
                previousLineNeedsContinuation = false;
                continue;
            }

            let currentIndent = indentLevel;
            let leadingCloseBraceHandled = false;
            
            if (trimmed.startsWith('}') && !trimmed.match(/^}\s*[\)\]\>]/)) {
                indentLevel = Math.max(0, indentLevel - 1);
                currentIndent = indentLevel;
                leadingCloseBraceHandled = true;
                // Only end switch if we're back at the switch indent level
                if (trimmed === '}' && inSwitch && indentLevel < switchIndentLevel) {
                    inSwitch = false;
                    switchIndentLevel = 0;
                    lastLineWasCaseLabel = false;
                    inCaseBody = false;
                }
            }
            
            if (trimmed.match(/^[\}\]\>]\s*\)/) && lpcStructureIndentStack.length > 0) {
                if (lpcStructureIndentStack.length > 0) {
                    currentIndent = Math.max(0, lpcStructureIndentStack[lpcStructureIndentStack.length - 1] - 1);
                } else {
                    currentIndent = indentLevel;
                }
            }
            
            if (trimmed.includes('switch(')) {
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
                if (trimmed !== '{') {
                    currentIndent = indentLevel + 1;
                }
                expectSingleStatementIndent = false;
                lastLineWasCaseLabel = false;
            }
            else if (previousLineWasFunctionCall && previousLineNeedsContinuation) {
                currentIndent = previousCurrentIndent + 1;
                lastLineWasCaseLabel = false;
            }
            else if (previousLineNeedsContinuation && lpcDataStructureDepth === 0) {
                const previousLine = i > 0 ? lines[i - 1].trim() : '';
                const isNewMappingKey = trimmed.match(/^"[^"]+"\s*:\s*\(/);
                const previousWasMappingValue = previousLine.match(/\}\),\s*$/);
                
                if (isNewMappingKey && previousWasMappingValue) {
                    currentIndent = indentLevel;
                } else {
                    currentIndent = Math.max(indentLevel + 1, previousCurrentIndent);
                }
                lastLineWasCaseLabel = false;
            }
            else if (trimmed === ')') {
                if (bracketStack.length > 0) {
                    const matchingParen = bracketStack[bracketStack.length - 1];
                    const matchingLine = lines[matchingParen.lineIndex];
                    const leadingSpaces = matchingLine.match(/^\s*/)?.[0].length || 0;
                    currentIndent = Math.floor(leadingSpaces / 4);
                } else if (lpcStructureIndentStack.length > 0) {
                    currentIndent = lpcStructureIndentStack[lpcStructureIndentStack.length - 1];
                } else if (previousLineNeedsContinuation) {
                    currentIndent = previousCurrentIndent;
                } else {
                    currentIndent = indentLevel;
                }
                lastLineWasCaseLabel = false;
            }
            else if (trimmed === '),') {
                if (lpcStructureIndentStack.length > 0) {
                    currentIndent = lpcStructureIndentStack[lpcStructureIndentStack.length - 1];
                } else if (bracketStack.length > 0) {
                    const matchingParen = bracketStack[bracketStack.length - 1];
                    const matchingLine = lines[matchingParen.lineIndex];
                    const leadingSpaces = matchingLine.match(/^\s*/)?.[0].length || 0;
                    currentIndent = Math.floor(leadingSpaces / 4);
                } else {
                    currentIndent = indentLevel;
                }
                lastLineWasCaseLabel = false;
            }
            else if (trimmed === ');') {
                if (bracketStack.length > 0) {
                    const matchingParen = bracketStack[bracketStack.length - 1];
                    const matchingLine = lines[matchingParen.lineIndex];
                    const leadingSpaces = matchingLine.match(/^\s*/)?.[0].length || 0;
                    currentIndent = Math.floor(leadingSpaces / 4);
                } else {
                    currentIndent = indentLevel;
                }
                lastLineWasCaseLabel = false;
            }
            else if (lpcStructureIndentStack.length > 0 && !trimmed.match(/^[\}\]\>]\s*\)/) && trimmed !== ')') {
                currentIndent = lpcStructureIndentStack[lpcStructureIndentStack.length - 1];
                
                // Check if bracket stack gives higher indent (for nested function calls inside LPC structures)
                if (bracketStack.length > 0 && !trimmed.match(/^[\)\}\]\>]/)) {
                    const matchingParen = bracketStack[bracketStack.length - 1];
                    if (matchingParen.char === '(') {
                        const matchingLine = lines[matchingParen.lineIndex];
                        const leadingSpaces = matchingLine.match(/^\s*/)?.[0].length || 0;
                        const baseIndent = Math.floor(leadingSpaces / 4);
                        const bracketIndent = baseIndent + 1;
                        currentIndent = Math.max(currentIndent, bracketIndent);
                    }
                }
                
                lastLineWasCaseLabel = false;
            }
            else if (bracketStack.length > 0 && !trimmed.match(/^[\)\}\]\>]/)) {
                const matchingParen = bracketStack[bracketStack.length - 1];
                if (matchingParen.char === '(') {
                    const matchingLine = lines[matchingParen.lineIndex];
                    const leadingSpaces = matchingLine.match(/^\s*/)?.[0].length || 0;
                    const baseIndent = Math.floor(leadingSpaces / 4);
                    currentIndent = baseIndent + 1;
                } else {
                    currentIndent = indentLevel;
                }
                lastLineWasCaseLabel = false;
            }
            
            else if (trimmed.match(/^(\&\&|\|\|)/)) {
                currentIndent = indentLevel + 1;
                lastLineWasCaseLabel = false;
            }
            
            else {
                lastLineWasCaseLabel = false;
            }

            const spaces = '    '.repeat(currentIndent);
            // Normalize spacing: collapse multiple spaces after commas to single space
            const normalizedTrimmed = trimmed.replace(/,\s{2,}/g, ', ');
            const formattedLine = spaces + normalizedTrimmed;
            
            // K&R function brace style: merge standalone { with previous function declaration
            let mergedWithPrevLine = false;
            if (trimmed === '{' && result.length > 0) {
                const prevLine = result[result.length - 1].trim();
                // Check if previous line looks like a function declaration (ends with ))
                // but exclude control structures and other patterns
                const isFunctionDecl = prevLine.match(/^(static\s+|private\s+|protected\s+|public\s+|nomask\s+|varargs\s+|deprecated\s+)*(void|int|string|object|mixed|float|status|mapping|closure|symbol|bytes|struct|lwobject|coroutine|lpctype)\s*\**\s+\w+\s*\([^)]*\)\s*$/);
                const isControlFlow = prevLine.match(/^\s*(if|while|for|foreach|do|switch|catch|else\s+if)\s*\(/);
                
                if (isFunctionDecl && !isControlFlow) {
                    // Append { to previous line
                    result[result.length - 1] = result[result.length - 1] + ' {';
                    mergedWithPrevLine = true;
                }
            }
            
            if (!mergedWithPrevLine) {
                result.push(formattedLine);
            }
            
            for (let col = 0; col < formattedLine.length; col++) {
                const char = formattedLine[col];
                const nextChar = col + 1 < formattedLine.length ? formattedLine[col + 1] : '';
                const prevChar = col > 0 ? formattedLine[col - 1] : '';
                
                if (char === '(' && (nextChar === '{' || nextChar === '[' || nextChar === '<')) {
                    const restOfLine = formattedLine.substring(col + 2);
                    const isCast = restOfLine.match(/^(int|string|object|float|mixed|mapping|status|closure|symbol|void|bytes|struct|lwobject|coroutine)\s*\)/);
                    
                    if (isCast) {
                        bracketStack.push({ char: '(', column: col, lineIndex: i });
                        col++;
                        continue;
                    }
                    
                    // Skip the opening paren of LPC structures
                    col++;
                    continue;
                }
                
                // Skip closing braces/brackets of LPC structures (}), ]), >))
                if ((char === '}' || char === ']' || char === '>') && (nextChar === ')')) {
                    continue;
                }
                
                // Skip closing paren of LPC structures
                if (char === ')' && (prevChar === '}' || prevChar === ']' || prevChar === '>')) {
                    continue;
                }
                
                if (char === '(' || char === '[' || char === '{') {
                    bracketStack.push({ char, column: col, lineIndex: i });
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

            if (trimmed.endsWith(';') || trimmed.match(/;\s*(\/\/|\/\*)/)) {
                bracketStack.length = 0;
                lpcStructureIndentStack.length = 0;
            }

            previousCurrentIndent = currentIndent;
            previousLineNeedsContinuation = this.needsContinuation(trimmed, lpcDataStructureDepth > 0);
            
            previousLineWasFunctionCall = (trimmed.endsWith('(') || (this.hasUnclosedBrackets(trimmed) && !!trimmed.match(/\w+\s*\(/))) 
                && !trimmed.match(/[{\[<]\s*\(\s*$/);
            
            if (!trimmed.endsWith('{') && this.isControlStatementWithoutBrace(trimmed)) {
                expectSingleStatementIndent = true;
            }

            let openBraceCount = 0;
            let closeBraceCount = 0;
            
            for (let i = 0; i < trimmed.length; i++) {
                const char = trimmed[i];
                const nextChar = i + 1 < trimmed.length ? trimmed[i + 1] : '';
                const prevChar = i > 0 ? trimmed[i - 1] : '';
                
                if (char === '(' && (nextChar === '{' || nextChar === '[' || nextChar === '<')) {
                    // LPC data structure opening - don't count for indentLevel
                } else if (char === '{') {
                    if (prevChar !== '(' && prevChar !== '[' && prevChar !== '<') {
                        openBraceCount++;
                    }
                } else if (char === ')' && (prevChar === '}' || prevChar === ']' || prevChar === '>')) {
                    // LPC data structure closing - don't count for indentLevel
                } else if (char === '}') {
                    if (i === 0 && leadingCloseBraceHandled) {
                        continue;
                    }
                    if (nextChar !== ')' && nextChar !== ']' && nextChar !== '>') {
                        closeBraceCount++;
                    }
                }
            }
            
            const openingMatches = trimmed.match(/\(\{|\(\[|\(\</g);
            const closingMatches = trimmed.match(/\}\)|\]\)|\>\)/g);
            
            const openingCount = openingMatches ? openingMatches.length : 0;
            const closingCount = closingMatches ? closingMatches.length : 0;
            const netLPCChange = openingCount - closingCount;
            
            const netBraces = openBraceCount - closeBraceCount;
            if (netBraces > 0) {
                indentLevel += netBraces;
                expectSingleStatementIndent = false;
            }
            
            if (openingMatches) {
                lpcDataStructureDepth += openingMatches.length;
            }
            
            if (closingMatches) {
                lpcDataStructureDepth = Math.max(0, lpcDataStructureDepth - closingCount);
            }
            
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

        return result.join('\n');
    }

    private needsContinuation(line: string, insideLPCStructure: boolean = false): boolean {
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
        
        if (trimmedLine.match(/(\|\||\&\&)\s*$/)) {
            return true;
        }
        
        if (trimmedLine.match(/[+\-*/%]\s*$/) && !trimmedLine.match(/^\s*(case\s+|default\s*:)/)) {
            return true;
        }
        
        if (trimmedLine.endsWith(',') && !insideLPCStructure) {
            return true;
        }
        
        return false;
    }

    private hasUnclosedBrackets(line: string): boolean {
        let parens = 0, brackets = 0, braces = 0;
        
        for (const char of line) {
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

    private isControlStatementWithoutBrace(line: string): boolean {
        if (line.match(/^\s*(?:if|while|for|foreach)\s*\(/) && line.trimEnd().endsWith(')')) {
            return true;
        }
        
        if (line.match(/^\s*else\s*$/)) {
            return true;
        }
        
        if (line.match(/^\s*else\s+if\s*\(/) && line.trimEnd().endsWith(')')) {
            return true;
        }
        
        if (line.match(/^\s*do\s*$/)) {
            return true;
        }
        
        return false;
    }
}