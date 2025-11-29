"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LPCDocumentFormattingEditProvider = void 0;
const vscode = __importStar(require("vscode"));
class LPCDocumentFormattingEditProvider {
    provideDocumentFormattingEdits(document, options, token) {
        const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
        return this.provideDocumentRangeFormattingEdits(document, fullRange, options, token);
    }
    provideDocumentRangeFormattingEdits(document, range, options, token) {
        try {
            const text = document.getText(range);
            const formattedText = this.formatLPCCode(text, options);
            if (formattedText === text) {
                return [];
            }
            return [vscode.TextEdit.replace(range, formattedText)];
        }
        catch (error) {
            console.error('LPC Formatting Error:', error);
            return [];
        }
    }
    formatLPCCode(code, options) {
        let lines = this.preprocessLines(code.split(/\r?\n/));
        let result = [];
        let indentLevel = 0;
        let inSwitch = false;
        let switchIndentLevel = 0;
        let lastLineWasCaseLabel = false;
        let inCaseBody = false;
        let previousLineNeedsContinuation = false;
        let previousLineWasFunctionCall = false;
        let previousCurrentIndent = 0;
        let previousLineHadUnclosedBrackets = false;
        let inMultiLineControlStatement = false;
        let stringContinuationColumn = -1;
        let lpcStructureIndentStack = [];
        let inBlockComment = false;
        let blockCommentIndent = 0;
        let expectSingleStatementIndent = false;
        let lpcDataStructureDepth = 0;
        const bracketStack = [];
        let preprocessorIndentStack = [];
        let lastLineWasPreprocessor = false;
        let inBackslashStringContinuation = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            // Handle backslash string continuation - preserve original line as-is
            if (inBackslashStringContinuation) {
                result.push(line);
                // Check if this line also ends with backslash to continue
                inBackslashStringContinuation = line.trimEnd().endsWith('\\');
                continue;
            }
            const specialLineResult = this.handleSpecialLine(trimmed, indentLevel, {
                inBlockComment,
                blockCommentIndent,
                preprocessorIndentStack
            });
            if (specialLineResult.handled) {
                if (specialLineResult.output !== undefined) {
                    if (Array.isArray(specialLineResult.output)) {
                        result.push(...specialLineResult.output);
                    }
                    else {
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
                }
                if (specialLineResult.wasPreprocessor) {
                    lastLineWasPreprocessor = true;
                }
                continue;
            }
            lastLineWasPreprocessor = false;
            let currentIndent = indentLevel;
            let leadingCloseBraceHandled = false;
            if (trimmed.startsWith('}') && !trimmed.match(/^}\s*[\)\]\>]/)) {
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
            if (trimmed.match(/^[\}\]\>]\s*\)/) && lpcStructureIndentStack.length > 0) {
                if (lpcStructureIndentStack.length > 0) {
                    currentIndent = Math.max(0, lpcStructureIndentStack[lpcStructureIndentStack.length - 1] - 1);
                }
                else {
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
                }
                else {
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
                }
                else if (lpcStructureIndentStack.length > 0 && trimmed.startsWith('),')) {
                    currentIndent = lpcStructureIndentStack[lpcStructureIndentStack.length - 1];
                }
                else {
                    currentIndent = indentLevel;
                }
                lastLineWasCaseLabel = false;
            }
            else if (previousLineWasFunctionCall && previousLineNeedsContinuation) {
                currentIndent = previousCurrentIndent + 1;
                lastLineWasCaseLabel = false;
            }
            else if (trimmed.match(/^(\&\&|\|\|)/) && lpcDataStructureDepth === 0) {
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
                    }
                    else {
                        currentIndent = Math.max(indentLevel + 1, previousCurrentIndent);
                        stringContinuationColumn = -1;
                    }
                }
                else {
                    stringContinuationColumn = -1;
                    if (isNewMappingKey && previousWasMappingValue) {
                        currentIndent = indentLevel;
                    }
                    else {
                        currentIndent = Math.max(indentLevel + 1, previousCurrentIndent);
                    }
                }
                lastLineWasCaseLabel = false;
            }
            else if (lpcStructureIndentStack.length > 0 && !trimmed.match(/^[\}\]\>]\s*\)/) && trimmed !== ')') {
                currentIndent = lpcStructureIndentStack[lpcStructureIndentStack.length - 1];
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
                }
                else {
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
            if (expectSingleStatementIndent &&
                inMultiLineControlStatement &&
                !previousLineHadUnclosedBrackets &&
                currentIndent === indentLevel) {
                currentIndent = indentLevel + 1;
                expectSingleStatementIndent = false;
                inMultiLineControlStatement = false;
            }
            let spaces = '    '.repeat(currentIndent);
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
            }
            else if (!mergedWithPrevLine) {
                result.push(formattedLine);
            }
            // Check if this line starts a backslash string continuation
            // This happens when a line ends with \ inside a string
            if (this.endsWithBackslashInString(trimmed)) {
                inBackslashStringContinuation = true;
            }
            let charInString = false;
            let charInLineComment = false;
            let charInBlockComment = false;
            for (let col = 0; col < formattedLine.length; col++) {
                const char = formattedLine[col];
                const nextChar = col + 1 < formattedLine.length ? formattedLine[col + 1] : '';
                const prevChar = col > 0 ? formattedLine[col - 1] : '';
                // Properly handle escaped quotes by counting preceding backslashes
                if (char === '"') {
                    let backslashCount = 0;
                    let j = col - 1;
                    while (j >= 0 && formattedLine[j] === '\\') {
                        backslashCount++;
                        j--;
                    }
                    // If even number of backslashes (or zero), the quote is not escaped
                    if (backslashCount % 2 === 0) {
                        charInString = !charInString;
                    }
                    continue;
                }
                if (charInString)
                    continue;
                if (!charInBlockComment && char === '/' && nextChar === '/') {
                    charInLineComment = true;
                }
                if (charInLineComment)
                    continue;
                if (char === '/' && nextChar === '*') {
                    charInBlockComment = true;
                    col++;
                    continue;
                }
                if (charInBlockComment && char === '*' && nextChar === '/') {
                    charInBlockComment = false;
                    col++;
                    continue;
                }
                if (charInBlockComment)
                    continue;
                if (char === '(' && (nextChar === '{' || nextChar === '[' || nextChar === '<')) {
                    const restOfLine = formattedLine.substring(col + 2);
                    const isCast = restOfLine.match(/^(int|string|object|float|mixed|mapping|status|closure|symbol|void|bytes|struct|lwobject|coroutine)\s*\)/);
                    if (isCast) {
                        bracketStack.push({ char: '(', column: col, lineIndex: i, assignedIndent: currentIndent });
                        col++;
                        continue;
                    }
                    col++;
                    continue;
                }
                if ((char === '}' || char === ']' || char === '>') && (nextChar === ')')) {
                    continue;
                }
                if (char === ')' && (prevChar === '}' || prevChar === ']' || prevChar === '>')) {
                    continue;
                }
                if (char === '[' && col >= 2 && formattedLine[col - 1] === '\'' && formattedLine[col - 2] === '#') {
                    continue;
                }
                if (char === '(' || char === '[' || char === '{') {
                    bracketStack.push({ char, column: col, lineIndex: i, assignedIndent: currentIndent });
                }
                else if (char === ')' || char === ']' || char === '}') {
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
            previousLineHadUnclosedBrackets = this.hasUnclosedBrackets(trimmed);
            previousLineWasFunctionCall = (trimmed.endsWith('(') || (this.hasUnclosedBrackets(trimmed) && !!trimmed.match(/\w+\s*\(/)))
                && !trimmed.match(/[{\[<]\s*\(\s*$/);
            const trimmedWithoutComments = this.stripCommentsAndStrings(trimmed);
            if (!trimmedWithoutComments.endsWith('{') && this.isControlStatementWithoutBrace(trimmed)) {
                expectSingleStatementIndent = true;
                if (this.hasUnclosedBrackets(trimmed)) {
                    inMultiLineControlStatement = true;
                }
            }
            const { openBraceCount, closeBraceCount, openingCount, closingCount } = this.countBracesAndStructures(trimmed, leadingCloseBraceHandled);
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
            if (netLPCChange > 0) {
                const elementIndent = currentIndent + 1;
                for (let i = 0; i < netLPCChange; i++) {
                    lpcStructureIndentStack.push(elementIndent);
                }
            }
            else if (netLPCChange < 0) {
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
    preprocessLines(lines) {
        const preprocessedLines = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                preprocessedLines.push(line);
                continue;
            }
            let codeOnly = trimmed;
            const lineCommentPos = trimmed.indexOf('//');
            if (lineCommentPos >= 0) {
                codeOnly = trimmed.substring(0, lineCommentPos).trim();
            }
            const blockCommentPos = trimmed.indexOf('/*');
            if (blockCommentPos >= 0) {
                codeOnly = trimmed.substring(0, blockCommentPos).trim();
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
                }
                else {
                    preprocessedLines.push(line);
                }
            }
            else {
                preprocessedLines.push(line);
            }
        }
        return preprocessedLines;
    }
    handleSpecialLine(trimmed, indentLevel, state) {
        if (!state.inBlockComment && trimmed.includes('/*')) {
            const startPos = trimmed.indexOf('/*');
            const endPos = trimmed.indexOf('*/', startPos);
            if (endPos === -1) {
                const spaces = '    '.repeat(indentLevel);
                const afterComment = trimmed.substring(startPos + 2).trim();
                if (afterComment.length > 0) {
                    return {
                        handled: true,
                        output: [spaces + '/*', spaces + ' * ' + afterComment],
                        inBlockComment: true,
                        blockCommentIndent: indentLevel
                    };
                }
                else {
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
            const spaces = '    '.repeat(state.blockCommentIndent);
            let formattedComment = trimmed;
            if (trimmed.startsWith('*') && !trimmed.startsWith('*/')) {
                formattedComment = ' * ';
                const textAfterAsterisk = trimmed.substring(1).trim();
                if (textAfterAsterisk.length > 0) {
                    formattedComment += textAfterAsterisk;
                }
            }
            else if (trimmed.startsWith('*/')) {
                formattedComment = ' */';
            }
            else if (trimmed.length > 0) {
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
            const spaces = '    '.repeat(indentLevel);
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
            let newIndentLevel;
            if (trimmed.match(/^#\s*if/)) {
                state.preprocessorIndentStack.push(indentLevel);
            }
            else if (trimmed.match(/^#\s*else/) || trimmed.match(/^#\s*elif/)) {
                if (state.preprocessorIndentStack.length > 0) {
                    newIndentLevel = state.preprocessorIndentStack[state.preprocessorIndentStack.length - 1];
                }
            }
            else if (trimmed.match(/^#\s*endif/)) {
                if (state.preprocessorIndentStack.length > 0) {
                    state.preprocessorIndentStack.pop();
                }
            }
            return {
                handled: true,
                output: trimmed,
                updateIndentLevel: newIndentLevel,
                resetFlags: true,
                wasPreprocessor: true
            };
        }
        return { handled: false };
    }
    normalizeSpacing(code) {
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
        normalized = this.replaceOutsideStrings(normalized, /([a-zA-Z0-9_")\]}])\-([a-zA-Z0-9_"({])/g, '$1 - $2');
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
    alignInlineComment(normalizedCode, commentPart) {
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
    countBracesAndStructures(trimmed, leadingCloseBraceHandled) {
        let openBraceCount = 0;
        let closeBraceCount = 0;
        let braceInString = false;
        let braceInLineComment = false;
        let braceInBlockComment = false;
        for (let i = 0; i < trimmed.length; i++) {
            const char = trimmed[i];
            const nextChar = i + 1 < trimmed.length ? trimmed[i + 1] : '';
            const prevChar = i > 0 ? trimmed[i - 1] : '';
            if (char === '"') {
                let backslashCount = 0;
                let j = i - 1;
                while (j >= 0 && trimmed[j] === '\\') {
                    backslashCount++;
                    j--;
                }
                if (backslashCount % 2 === 0) {
                    braceInString = !braceInString;
                }
                continue;
            }
            if (braceInString) {
                continue;
            }
            if (!braceInBlockComment && char === '/' && nextChar === '/') {
                braceInLineComment = true;
            }
            if (braceInLineComment) {
                continue;
            }
            if (char === '/' && nextChar === '*') {
                braceInBlockComment = true;
                i++;
                continue;
            }
            if (braceInBlockComment && char === '*' && nextChar === '/') {
                braceInBlockComment = false;
                i++;
                continue;
            }
            if (braceInBlockComment) {
                continue;
            }
            if (char === '(' && (nextChar === '{' || nextChar === '[' || nextChar === '<')) {
                i++;
                continue;
            }
            else if (char === '{') {
                if (prevChar !== '(' && prevChar !== '[' && prevChar !== '<') {
                    openBraceCount++;
                }
            }
            else if (char === ')' && (prevChar === '}' || prevChar === ']' || prevChar === '>')) {
                continue;
            }
            else if (char === '}' || char === ']' || char === '>') {
                if (nextChar === ')') {
                    i++;
                    continue;
                }
                if (char === '}') {
                    if (i === 0 && leadingCloseBraceHandled) {
                        continue;
                    }
                    closeBraceCount++;
                }
            }
        }
        // Count LPC-specific structures like ({ }), ([ ]), (< >)
        // But only count them if they're NOT inside strings or comments
        let openingCount = 0;
        let closingCount = 0;
        let inStr = false;
        let inLineComm = false;
        let inBlockComm = false;
        for (let i = 0; i < trimmed.length - 1; i++) {
            const char = trimmed[i];
            const nextChar = trimmed[i + 1];
            // Track string boundaries
            if (char === '"') {
                let backslashCount = 0;
                let j = i - 1;
                while (j >= 0 && trimmed[j] === '\\') {
                    backslashCount++;
                    j--;
                }
                if (backslashCount % 2 === 0) {
                    inStr = !inStr;
                }
                continue;
            }
            if (inStr)
                continue;
            // Track line comments
            if (!inBlockComm && char === '/' && nextChar === '/') {
                inLineComm = true;
            }
            if (inLineComm)
                continue;
            // Track block comments
            if (char === '/' && nextChar === '*') {
                inBlockComm = true;
                i++;
                continue;
            }
            if (inBlockComm && char === '*' && nextChar === '/') {
                inBlockComm = false;
                i++;
                continue;
            }
            if (inBlockComm)
                continue;
            // Count opening patterns
            if (char === '(' && (nextChar === '{' || nextChar === '[' || nextChar === '<')) {
                openingCount++;
            }
            // Count closing patterns
            if ((char === '}' || char === ']' || char === '>') && nextChar === ')') {
                closingCount++;
            }
        }
        return { openBraceCount, closeBraceCount, openingCount, closingCount };
    }
    isInsideString(line, position) {
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
            }
            else if (char === stringChar && inString) {
                inString = false;
                stringChar = '';
            }
        }
        return inString;
    }
    endsWithBackslashInString(line) {
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
    replaceOutsideStrings(line, pattern, replacement) {
        let result = '';
        let lastIndex = 0;
        // Find all matches
        const matches = [];
        let match;
        while ((match = pattern.exec(line)) !== null) {
            matches.push({ index: match.index, match });
        }
        // Apply replacements only if not inside strings
        for (const { index, match } of matches) {
            // Add the part before this match
            result += line.substring(lastIndex, index);
            // Check if ANY character in the match is inside a string
            let insideString = false;
            for (let i = 0; i < match[0].length; i++) {
                if (this.isInsideString(line, index + i)) {
                    insideString = true;
                    break;
                }
            }
            if (!insideString) {
                // Not inside string - apply replacement
                if (typeof replacement === 'function') {
                    result += replacement(match[0], ...match.slice(1));
                }
                else {
                    result += match[0].replace(pattern, replacement);
                }
            }
            else {
                // Inside string - keep original
                result += match[0];
            }
            lastIndex = index + match[0].length;
        }
        // Add the remaining part
        result += line.substring(lastIndex);
        return result || line;
    }
    postProcessMultiLinePatterns(lines) {
        const processed = [];
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
            const isClosureContent = (content) => {
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
            }
            else {
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
                    }
                    else {
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
    needsContinuation(line, insideLPCStructure = false) {
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
    hasUnclosedBrackets(line) {
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
            // Count brackets only outside strings
            switch (char) {
                case '(':
                    parens++;
                    break;
                case ')':
                    parens--;
                    break;
                case '[':
                    brackets++;
                    break;
                case ']':
                    brackets--;
                    break;
                case '{':
                    braces++;
                    break;
                case '}':
                    braces--;
                    break;
            }
        }
        return parens > 0 || brackets > 0 || braces > 0;
    }
    stripCommentsAndStrings(line) {
        let result = '';
        let inString = false;
        let inLineComment = false;
        let inBlockComment = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = i + 1 < line.length ? line[i + 1] : '';
            const prevChar = i > 0 ? line[i - 1] : '';
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
                result += char;
                continue;
            }
            if (inString) {
                result += ' ';
                continue;
            }
            if (!inBlockComment && char === '/' && nextChar === '/') {
                inLineComment = true;
            }
            if (inLineComment) {
                result += ' ';
                continue;
            }
            if (char === '/' && nextChar === '*') {
                inBlockComment = true;
                i++;
                result += '  ';
                continue;
            }
            if (inBlockComment && char === '*' && nextChar === '/') {
                inBlockComment = false;
                i++;
                result += '  ';
                continue;
            }
            if (inBlockComment) {
                result += ' ';
                continue;
            }
            result += char;
        }
        return result.trimEnd();
    }
    isControlStatementWithoutBrace(line) {
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
exports.LPCDocumentFormattingEditProvider = LPCDocumentFormattingEditProvider;
//# sourceMappingURL=formatProvider.js.map