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
        let lines = code.split(/\r?\n/);
        
        // Preprocess: split lines that have statements followed by closing braces (e.g., "statement; }")
        let preprocessedLines: string[] = [];
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Skip lines that are comments
            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                preprocessedLines.push(line);
                continue;
            }
            
            // Remove comment portion from line before checking for ; } pattern
            let codeOnly = trimmed;
            const lineCommentPos = trimmed.indexOf('//');
            if (lineCommentPos >= 0) {
                codeOnly = trimmed.substring(0, lineCommentPos).trim();
            }
            const blockCommentPos = trimmed.indexOf('/*');
            if (blockCommentPos >= 0) {
                codeOnly = trimmed.substring(0, blockCommentPos).trim();
            }
            
            // Check if line ends with ; } or ; } followed by more closing braces
            // BUT exclude one-liner functions (e.g., "function() { statement; }")
            // AND exclude one-liner control statements (e.g., "if(x) { statement; }")
            const isOneLinerFunction = codeOnly.match(/^[a-zA-Z_][\w\s*]*\([^)]*\)\s*\{[^}]*\}\s*$/);
            // For control statements, just check if it starts with the keyword and has both { and } on same line
            const isOneLinerControl = codeOnly.match(/^(if|while|for|foreach)\s*\(/) && codeOnly.includes('{') && codeOnly.includes('}');
            if (codeOnly.match(/;\s*\}+\s*$/) && !isOneLinerFunction && !isOneLinerControl) {
                // Split the statement and closing braces
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
        
        lines = preprocessedLines;
        
        let result: string[] = [];
        let indentLevel = 0;
        let inSwitch = false;
        let switchIndentLevel = 0;
        let lastLineWasCaseLabel = false;
        let inCaseBody = false;
        let previousLineNeedsContinuation = false;
        let previousLineWasFunctionCall = false;
        let previousCurrentIndent = 0;
        let stringContinuationColumn = -1;  // Track column position for string alignment
        let lpcStructureIndentStack: number[] = [];
        let inBlockComment = false;
        let blockCommentIndent = 0;
        let expectSingleStatementIndent = false;
        let lpcDataStructureDepth = 0;
        const bracketStack: Array<{ char: string; column: number; lineIndex: number; assignedIndent: number }> = [];
        let preprocessorIndentStack: number[] = [];  // Track indent levels for #ifdef/#else/#endif
        let lastLineWasPreprocessor = false;

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
                // Handle preprocessor directives
                if (trimmed.match(/^#\s*if/)) {
                    // #ifdef, #ifndef, #if - save current indent level
                    preprocessorIndentStack.push(indentLevel);
                } else if (trimmed.match(/^#\s*else/) || trimmed.match(/^#\s*elif/)) {
                    // #else, #elif - restore indent level from before #if
                    if (preprocessorIndentStack.length > 0) {
                        indentLevel = preprocessorIndentStack[preprocessorIndentStack.length - 1];
                    }
                } else if (trimmed.match(/^#\s*endif/)) {
                    // #endif - pop the saved indent level
                    if (preprocessorIndentStack.length > 0) {
                        preprocessorIndentStack.pop();
                    }
                }
                result.push(trimmed);
                previousLineNeedsContinuation = false;
                lastLineWasPreprocessor = true;
                continue;
            }
            
            lastLineWasPreprocessor = false;

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
                expectSingleStatementIndent = false;
                lastLineWasCaseLabel = false;
            }
            // Closing parentheses should align with the base indent of the line with opening bracket
            else if (trimmed.startsWith(')')) {
                // Find the matching opening parenthesis (not bracket or brace)
                let matchingParen = null;
                for (let j = bracketStack.length - 1; j >= 0; j--) {
                    if (bracketStack[j].char === '(') {
                        matchingParen = bracketStack[j];
                        break;
                    }
                }
                
                if (matchingParen) {
                    // Use the stored base indent level (already in indent units)
                    currentIndent = matchingParen.assignedIndent;
                } else if (lpcStructureIndentStack.length > 0 && trimmed.startsWith('),')) {
                    currentIndent = lpcStructureIndentStack[lpcStructureIndentStack.length - 1];
                } else {
                    currentIndent = indentLevel;
                }
                lastLineWasCaseLabel = false;
            }
            else if (previousLineWasFunctionCall && previousLineNeedsContinuation) {
                currentIndent = previousCurrentIndent + 1;
                lastLineWasCaseLabel = false;
            }
            // Lines starting with && or || should maintain continuation indent
            else if (trimmed.match(/^(\&\&|\|\|)/) && lpcDataStructureDepth === 0) {
                currentIndent = Math.max(indentLevel + 1, previousCurrentIndent);
                lastLineWasCaseLabel = false;
            }
            else if (previousLineNeedsContinuation && lpcDataStructureDepth === 0) {
                const previousLine = i > 0 ? lines[i - 1].trim() : '';
                const previousFormattedLine = result.length > 0 ? result[result.length - 1] : '';
                const isNewMappingKey = trimmed.match(/^"[^"]+"\s*:\s*\(/);
                const previousWasMappingValue = previousLine.match(/\}\),\s*$/);
                
                // Check if this is string continuation (starts with a quote and previous line has + continuation)
                if (trimmed.startsWith('"') && previousLine.endsWith('+')) {
                    let columnToUse = stringContinuationColumn;
                    
                    // If we don't have a stored column yet, find the opening quote
                    if (columnToUse < 0) {
                        // Find the opening quote on the previous formatted line or search back
                        let quotePos = previousFormattedLine.indexOf('"');
                        if (quotePos === -1 && result.length >= 2) {
                            // Check further back for the start of the string in formatted results
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
                        // Don't convert to indent level - keep exact column for spaces calculation
                        // Just set a reasonable indent level for tracking purposes
                        currentIndent = indentLevel + 1;
                        // stringContinuationColumn will be used and possibly reset later
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

            // Special handling for ternary operator alignment and string continuation
            let spaces = '    '.repeat(currentIndent);
            
            // If we're continuing a string, align to exact column position
            if (stringContinuationColumn >= 0) {
                spaces = ' '.repeat(stringContinuationColumn);
                // Reset the column if this line doesn't continue
                if (!trimmed.endsWith('+')) {
                    stringContinuationColumn = -1;
                }
            }
            
            let normalizedTrimmed = trimmed.replace(/,\s{2,}/g, ', ');
            
            // Normalize spacing in various contexts (but only outside strings)
            // 1. Remove extra spaces before closing parentheses, semicolons, opening braces (2+ spaces)
            normalizedTrimmed = this.replaceOutsideStrings(normalizedTrimmed, /\s{2,}([);{])/g, ' $1');
            // 1a. Remove all spaces before semicolons
            normalizedTrimmed = this.replaceOutsideStrings(normalizedTrimmed, /\s+;/g, ';');
            // 1b. Remove spaces between }) and ) (array closing followed by function closing)
            normalizedTrimmed = this.replaceOutsideStrings(normalizedTrimmed, /\}\)\s+\)/g, '})');
            
            // 1b. Remove extra spaces after opening parentheses (but preserve space before closures/arrays)
            // Remove spaces after (
            normalizedTrimmed = this.replaceOutsideStrings(normalizedTrimmed, /\(\s+/g, '(');
            
            // 1c. Remove extra spaces in type declarations (e.g., "int    var" -> "int var")
            normalizedTrimmed = this.replaceOutsideStrings(normalizedTrimmed, /\b(int|string|object|float|mixed|mapping|status|closure|symbol|void|bytes|struct|lwobject|coroutine)\s{2,}/g, '$1 ');
            
            // 1d. Normalize case statements - single space after 'case', no space before ':' in case labels
            normalizedTrimmed = this.replaceOutsideStrings(normalizedTrimmed, /\bcase\s{2,}/g, 'case ');
            normalizedTrimmed = this.replaceOutsideStrings(normalizedTrimmed, /\bcase\s+(.+?)\s+:/g, 'case $1:');
            
            // 2. Remove extra spaces in compound operators like ==, !=, <=, >=, +=, -=, etc.
            normalizedTrimmed = this.replaceOutsideStrings(normalizedTrimmed, /([=!<>+\-*/%&|^])\s{2,}=/g, '$1=');
            normalizedTrimmed = this.replaceOutsideStrings(normalizedTrimmed, /=\s{2,}([=>])/g, '=$1');
            
            // 3. Normalize spacing around assignment = operator (one space on each side)
            // But don't touch compound operators that already have =, and exclude #'= pattern
            normalizedTrimmed = this.replaceOutsideStrings(normalizedTrimmed, /([^=!<>+\-*/%&|^'])\s*=\s*([^=])/g, '$1 = $2');
            
            // 1e. Remove ALL spaces around operators after #' in function references (must come after assignment normalization)
            normalizedTrimmed = this.replaceOutsideStrings(normalizedTrimmed, /#'\s*([=!<>&|+\-*/%^]+)\s*/g, "#'$1");
            
            // 4. Remove extra spaces before + operator (for string concatenation)
            normalizedTrimmed = this.replaceOutsideStrings(normalizedTrimmed, /\s{2,}\+/g, ' +');
            
            // 5. Normalize inline closures (: ... :) - single space after (: and before :)
            normalizedTrimmed = this.replaceOutsideStrings(normalizedTrimmed, /\(:\s+/g, '(: ');
            normalizedTrimmed = this.replaceOutsideStrings(normalizedTrimmed, /\s+:\)/g, ' :)');
            // Also normalize multiple spaces inside inline closures to single spaces
            normalizedTrimmed = this.replaceOutsideStrings(normalizedTrimmed, /\(:\s+(.+?)\s+:\)/g, (match, content) => {
                // Normalize spaces inside the closure
                const normalized = content.replace(/\s{2,}/g, ' ');
                return `(: ${normalized} :)`;
            });
            
            // Check if this is a ternary continuation line
            const previousLine = i > 0 ? lines[i - 1].trim() : '';
            const previousHasTernary = previousLine.includes('?');
            const currentStartsWithColon = trimmed.startsWith(':');
            
            if (previousHasTernary && currentStartsWithColon && result.length > 0) {
                // Align ':' with '?' from previous line
                const prevFullLine = result[result.length - 1];
                const questionPos = prevFullLine.indexOf('?');
                if (questionPos >= 0) {
                    spaces = ' '.repeat(questionPos);
                }
            }
            
            const formattedLine = spaces + normalizedTrimmed;
            
            // K&R function brace style: merge standalone { with previous function declaration
            // BUT: varargs functions use old-style braces (opening brace on new line)
            // AND: if there are comment lines between signature and brace, keep brace on new line
            let mergedWithPrevLine = false;
            if (trimmed === '{' && result.length > 0) {
                const prevLine = result[result.length - 1].trim();
                // Check if previous line looks like a function declaration (ends with ))
                // but exclude control structures, varargs functions, and other patterns
                const isFunctionDecl = prevLine.match(/^(static\s+|private\s+|protected\s+|public\s+|nomask\s+|deprecated\s+)*(void|int|string|object|mixed|float|status|mapping|closure|symbol|bytes|struct|lwobject|coroutine|lpctype)\s*\**\s+\w+\s*\([^)]*\)\s*$/);
                const isControlFlow = prevLine.match(/^\s*(if|while|for|foreach|do|switch|catch|else\s+if)\s*\(/);
                const hasVarargs = prevLine.match(/\bvarargs\s+/);
                // Check if there are any non-empty lines (like comments) between function signature and opening brace
                const hasIntermediateLines = prevLine !== '' && !isFunctionDecl;
                
                if (isFunctionDecl && !isControlFlow && !hasVarargs && !hasIntermediateLines) {
                    // Append { to previous line (K&R style)
                    result[result.length - 1] = result[result.length - 1] + ' {';
                    mergedWithPrevLine = true;
                }
            }
            
            // Handle leading commas: move them to the end of the previous line (modern style)
            if (!mergedWithPrevLine && trimmed.startsWith(',') && result.length > 0) {
                // Add comma to end of previous line
                result[result.length - 1] = result[result.length - 1] + ',';
                // Remove leading comma and extra space from current line
                const withoutLeadingComma = trimmed.substring(1).trim();
                const fixedLine = spaces + withoutLeadingComma;
                result.push(fixedLine);
            } else if (!mergedWithPrevLine) {
                result.push(formattedLine);
            }
            
            // Track string and comment state in this line to skip their contents
            let charInString = false;
            let charInLineComment = false;
            let charInBlockComment = false;
            
            for (let col = 0; col < formattedLine.length; col++) {
                const char = formattedLine[col];
                const nextChar = col + 1 < formattedLine.length ? formattedLine[col + 1] : '';
                const prevChar = col > 0 ? formattedLine[col - 1] : '';
                
                // Track string state (skip escaped quotes)
                if (char === '"' && (col === 0 || formattedLine[col - 1] !== '\\')) {
                    charInString = !charInString;
                    continue;
                }
                
                // Skip everything inside strings
                if (charInString) {
                    continue;
                }
                
                // Track line comment state
                if (!charInBlockComment && char === '/' && nextChar === '/') {
                    charInLineComment = true;
                }
                
                // Skip everything inside line comments
                if (charInLineComment) {
                    continue;
                }
                
                // Track block comment state
                if (char === '/' && nextChar === '*') {
                    charInBlockComment = true;
                    col++; // Skip the *
                    continue;
                }
                
                if (charInBlockComment && char === '*' && nextChar === '/') {
                    charInBlockComment = false;
                    col++; // Skip the /
                    continue;
                }
                
                // Skip everything inside block comments
                if (charInBlockComment) {
                    continue;
                }
                
                if (char === '(' && (nextChar === '{' || nextChar === '[' || nextChar === '<')) {
                    const restOfLine = formattedLine.substring(col + 2);
                    const isCast = restOfLine.match(/^(int|string|object|float|mixed|mapping|status|closure|symbol|void|bytes|struct|lwobject|coroutine)\s*\)/);
                    
                    if (isCast) {
                        bracketStack.push({ char: '(', column: col, lineIndex: i, assignedIndent: currentIndent });
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
                
                // Skip '[' in efun operator syntax #'[
                if (char === '[' && col >= 2 && formattedLine[col - 1] === '\'' && formattedLine[col - 2] === '#') {
                    continue;
                }
                
                if (char === '(' || char === '[' || char === '{') {
                    // Store the current indent level (in indent units) where the closing bracket should align
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
            
            // Track string and comment state to skip counting braces inside them
            let braceInString = false;
            let braceInLineComment = false;
            let braceInBlockComment = false;
            
            for (let i = 0; i < trimmed.length; i++) {
                const char = trimmed[i];
                const nextChar = i + 1 < trimmed.length ? trimmed[i + 1] : '';
                const prevChar = i > 0 ? trimmed[i - 1] : '';
                
                // Track string state (skip escaped quotes)
                if (char === '"' && (i === 0 || trimmed[i - 1] !== '\\')) {
                    braceInString = !braceInString;
                    continue;
                }
                
                // Skip everything inside strings
                if (braceInString) {
                    continue;
                }
                
                // Track line comment state
                if (!braceInBlockComment && char === '/' && nextChar === '/') {
                    braceInLineComment = true;
                }
                
                // Skip everything inside line comments
                if (braceInLineComment) {
                    continue;
                }
                
                // Track block comment state
                if (char === '/' && nextChar === '*') {
                    braceInBlockComment = true;
                    i++; // Skip the *
                    continue;
                }
                
                if (braceInBlockComment && char === '*' && nextChar === '/') {
                    braceInBlockComment = false;
                    i++; // Skip the /
                    continue;
                }
                
                // Skip everything inside block comments
                if (braceInBlockComment) {
                    continue;
                }
                
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

        // Post-processing: Handle multi-line patterns
        result = this.postProcessMultiLinePatterns(result);

        return result.join('\n');
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

    private replaceOutsideStrings(line: string, pattern: RegExp, replacement: string | ((match: string, ...args: any[]) => string)): string {
        let result = '';
        let lastIndex = 0;
        
        // Find all matches
        const matches: Array<{index: number, match: RegExpExecArray}> = [];
        let match;
        while ((match = pattern.exec(line)) !== null) {
            matches.push({index: match.index, match});
        }
        
        // Apply replacements only if not inside strings
        for (const {index, match} of matches) {
            // Add the part before this match
            result += line.substring(lastIndex, index);
            
            if (!this.isInsideString(line, index)) {
                // Not inside string - apply replacement
                if (typeof replacement === 'function') {
                    result += replacement(match[0], ...match.slice(1));
                } else {
                    result += match[0].replace(pattern, replacement);
                }
            } else {
                // Inside string - keep original
                result += match[0];
            }
            lastIndex = index + match[0].length;
        }
        
        // Add the remaining part
        result += line.substring(lastIndex);
        return result || line;
    }

    private postProcessMultiLinePatterns(lines: string[]): string[] {
        const processed: string[] = [];
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            const trimmed = line.trim();
            
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
            
            // LDMUD convention: NO spaces in ({...}) for closures/lambdas and type casts
            // But KEEP spaces in regular data arrays like ({ 1, 2, 3 })
            // IMPORTANT: Only apply to code, NOT to content inside strings
            
            // 1. Remove spaces in type casts like ({int}), ({string*})
            line = line.replace(/\(\{\s*(int|string|object|float|mixed|mapping|status|closure|symbol|void|bytes|struct|lwobject|coroutine)(\*?)\s*\}\)/g, (match, type, star, offset) => {
                return this.isInsideString(line, offset) ? match : `({${type}${star}})`;
            });
            
            // 2. Process all ({ ... }) arrays, checking each one individually
            line = line.replace(/\(\{\s*([^}]+?)\s*\}\)/g, (match, content, offset) => {
                // Skip if inside a string
                if (this.isInsideString(line, offset)) {
                    return match;
                }
                
                const trimmed = content.trim();
                
                // Skip empty arrays and type casts (already handled)
                if (trimmed.length === 0 || trimmed.match(/^(int|string|object|float|mixed|mapping|status|closure|symbol|void|bytes|struct|lwobject|coroutine)\*?$/)) {
                    return match;
                }
                
                // Check if THIS specific array contains closure indicators
                const isClosure = trimmed.includes("#'") || trimmed.match(/'/); // Contains quoted symbols
                
                if (isClosure) {
                    // Closure array: remove spaces, but keep space before comments
                    const needsSpaceAfter = trimmed.startsWith('/*');
                    let result = needsSpaceAfter ? `({ ${trimmed}` : `({${trimmed}`;
                    // Remove trailing space before })
                    if (result.endsWith(' ')) {
                        result = result.slice(0, -1);
                    }
                    return result + '})';
                } else {
                    // Regular data array: normalize to exactly one space on each side
                    return `({ ${trimmed} })`;
                }
            });
            
            processed.push(line);
        }
        
        return processed;
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