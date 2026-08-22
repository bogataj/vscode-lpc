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
const LPC_SIMPLE_TYPE_PATTERN = 'void|int|float|string|object|mapping|mixed|status|closure|symbol|bytes|lwobject|coroutine|lpctype';
const LPC_TYPE_PATTERN = `${LPC_SIMPLE_TYPE_PATTERN}|struct`;
const LPC_DECLARATION_TYPE_PATTERN = `(?:${LPC_SIMPLE_TYPE_PATTERN}|struct(?:\\s+[A-Za-z_]\\w*)?)`;
const LPC_MODIFIER_PATTERN = 'static|private|protected|public|nomask|deprecated|varargs|virtual|nosave';
const LPC_FUNCTION_DECLARATION_PATTERN = new RegExp(`^(?:(?:${LPC_MODIFIER_PATTERN})\\s+)*(?:${LPC_DECLARATION_TYPE_PATTERN})\\s+(?:\\*+\\s*)?\\w+\\s*\\([^)]*\\)\\s*$`);
const LPC_SPLIT_POINTER_RETURN_PATTERN = new RegExp(`^(?:(?:${LPC_MODIFIER_PATTERN})\\s+)*(?:${LPC_DECLARATION_TYPE_PATTERN})\\s+\\*+\\s*$`);
const LPC_TYPE_WITH_OPTIONAL_POINTER_PATTERN = new RegExp(`^(?:${LPC_TYPE_PATTERN})\\*?$`);
class CharacterScanner {
    constructor() {
        this.inString = false;
        this.inLineComment = false;
        this.inBlockComment = false;
        this.stringDelimiter = null;
    }
    /** Process one character, updating state. */
    processChar(line, index) {
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
    startLine() {
        this.inLineComment = false;
    }
    clone() {
        const scanner = new CharacterScanner();
        scanner.inString = this.inString;
        scanner.inLineComment = this.inLineComment;
        scanner.inBlockComment = this.inBlockComment;
        scanner.stringDelimiter = this.stringDelimiter;
        return scanner;
    }
    isEscaped(line, index) {
        let backslashCount = 0;
        for (let i = index - 1; i >= 0 && line[i] === '\\'; i--) {
            backslashCount++;
        }
        return backslashCount % 2 === 1;
    }
    isCharacterLiteralStart(line, index) {
        if (line[index + 1] === '\\') {
            return index + 3 < line.length && line[index + 3] === "'";
        }
        return index + 2 < line.length && line[index + 2] === "'";
    }
}
class LPCDocumentFormattingEditProvider {
    provideDocumentFormattingEdits(document, options, token) {
        const config = vscode.workspace.getConfiguration('lpc.formatting');
        if (!config.get('enabled', true)) {
            return [];
        }
        const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
        const text = document.getText(fullRange);
        const indentSize = this.resolveIndentSize(config.get('indentSize'), options.tabSize);
        let formattedText = this.formatLPCCode(text, options, indentSize, token);
        if (config.get('insertFinalNewline', true) && !formattedText.endsWith('\n')) {
            formattedText += '\n';
        }
        if (formattedText === text) {
            return [];
        }
        return [vscode.TextEdit.replace(fullRange, formattedText)];
    }
    provideDocumentRangeFormattingEdits(document, range, options, token) {
        const config = vscode.workspace.getConfiguration('lpc.formatting');
        if (!config.get('enabled', true)) {
            return [];
        }
        const formattingRange = this.expandRangeToFullLines(document, range);
        if (this.rangeStartsInsideProtectedContext(document, formattingRange.start)) {
            return [];
        }
        const text = document.getText(formattingRange);
        const indentSize = this.resolveIndentSize(config.get('indentSize'), options.tabSize);
        const initialIndentLevel = this.getInitialIndentLevel(text, options, indentSize);
        const formattedText = this.formatLPCCode(text, options, indentSize, token, initialIndentLevel);
        if (formattedText === text) {
            return [];
        }
        return [vscode.TextEdit.replace(formattingRange, formattedText)];
    }
    rangeStartsInsideProtectedContext(document, start) {
        if (start.line === 0 && start.character === 0) {
            return false;
        }
        const prefix = document.getText(new vscode.Range(document.positionAt(0), start));
        const lines = prefix.split(/\r?\n/);
        const scanner = new CharacterScanner();
        for (const line of lines) {
            scanner.startLine();
            for (let index = 0; index < line.length; index++) {
                const { skipNext } = scanner.processChar(line, index);
                if (skipNext) {
                    index++;
                }
            }
        }
        const preprocessor = this.analyzePreprocessorLines(lines);
        return scanner.inString
            || scanner.inBlockComment
            || preprocessor.continuationLines[lines.length - 1];
    }
    expandRangeToFullLines(document, range) {
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
    resolveIndentSize(configuredIndentSize, fallback) {
        return Number.isInteger(configuredIndentSize) && configuredIndentSize !== undefined && configuredIndentSize > 0
            ? configuredIndentSize
            : Math.max(1, Math.floor(fallback));
    }
    getInitialIndentLevel(code, options, indentSize) {
        const lines = code.split(/\r?\n/);
        const preprocessor = this.analyzePreprocessorLines(lines);
        const firstContentLine = lines.find((line, index) => {
            const trimmed = line.trim();
            return trimmed.length > 0
                && !preprocessor.continuationLines[index]
                && !/^#(?!')/.test(trimmed);
        }) ?? lines.find(line => line.trim().length > 0);
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
    formatLPCCode(code, options, indentSize, token, initialIndentLevel = 0) {
        const indentString = options.insertSpaces
            ? ' '.repeat(indentSize)
            : '\t';
        const lines = this.preprocessLines(code.split(/\r?\n/));
        const unbracedIndentDepths = this.analyzeControlFlow(lines);
        const preprocessorLineInfo = this.analyzePreprocessorLines(lines);
        const preprocessorContinuationLines = preprocessorLineInfo.continuationLines;
        let result = [];
        let indentLevel = initialIndentLevel;
        const switchStack = [];
        let previousLineNeedsContinuation = false;
        let previousCurrentIndent = 0;
        let stringContinuationColumn = -1;
        let lpcStructureIndentStack = [];
        let inBlockComment = false;
        let blockCommentIndent = 0;
        let lpcDataStructureDepth = 0;
        const bracketStack = [];
        let preprocessorIndentStack = [];
        const preprocessorFormatStack = [];
        let inBackslashStringContinuation = false;
        let inPreprocessorContinuation = false;
        let pendingForHeader = false;
        for (let i = 0; i < lines.length; i++) {
            if (token?.isCancellationRequested) {
                return code;
            }
            const line = lines[i];
            const trimmed = line.trim();
            if (inPreprocessorContinuation) {
                result.push(line);
                inPreprocessorContinuation = this.endsWithLineContinuation(line);
                continue;
            }
            // Handle backslash string continuation - preserve original line as-is
            if (inBackslashStringContinuation) {
                result.push(line);
                const continuedString = this.scanContinuedStringLine(line);
                const continuationScanner = this.updateBracketStack(continuedString.code, previousCurrentIndent, bracketStack);
                if (continuationScanner.inBlockComment) {
                    inBlockComment = true;
                    blockCommentIndent = previousCurrentIndent;
                }
                const structureCounts = this.countBracesAndStructures(continuedString.code, false);
                indentLevel = Math.max(0, indentLevel + structureCounts.openBraceCount - structureCounts.closeBraceCount);
                lpcDataStructureDepth = Math.max(0, lpcDataStructureDepth + structureCounts.openingCount - structureCounts.closingCount);
                for (let count = 0; count < structureCounts.openingCount; count++) {
                    lpcStructureIndentStack.push(previousCurrentIndent + 1);
                }
                for (let count = 0; count < structureCounts.closingCount; count++) {
                    lpcStructureIndentStack.pop();
                }
                const isInsideForHeader = bracketStack.some(bracket => bracket.preservesSemicolons);
                if (continuedString.code.trimEnd().endsWith(';') && !isInsideForHeader) {
                    bracketStack.length = 0;
                    lpcStructureIndentStack.length = 0;
                }
                previousLineNeedsContinuation = this.needsContinuation(continuedString.code);
                inBackslashStringContinuation = continuedString.continues;
                continue;
            }
            const preprocessorDirective = inBlockComment
                ? undefined
                : trimmed.match(/^#\s*(if|ifdef|ifndef|elif|else|endif)\b/)?.[1];
            if (preprocessorDirective === 'if' || preprocessorDirective === 'ifdef'
                || preprocessorDirective === 'ifndef') {
                preprocessorFormatStack.push({
                    previousLineNeedsContinuation,
                    previousCurrentIndent,
                    stringContinuationColumn,
                    lpcDataStructureDepth,
                    bracketStack: bracketStack.map(bracket => ({ ...bracket })),
                    lpcStructureIndentStack: [...lpcStructureIndentStack],
                    switchStack: switchStack.map(context => ({ ...context })),
                    pendingForHeader
                });
            }
            else if (preprocessorDirective === 'else' || preprocessorDirective === 'elif') {
                const branchState = preprocessorFormatStack[preprocessorFormatStack.length - 1];
                if (branchState) {
                    previousLineNeedsContinuation = branchState.previousLineNeedsContinuation;
                    previousCurrentIndent = branchState.previousCurrentIndent;
                    stringContinuationColumn = branchState.stringContinuationColumn;
                    lpcDataStructureDepth = branchState.lpcDataStructureDepth;
                    bracketStack.splice(0, bracketStack.length, ...branchState.bracketStack.map(bracket => ({ ...bracket })));
                    lpcStructureIndentStack.splice(0, lpcStructureIndentStack.length, ...branchState.lpcStructureIndentStack);
                    switchStack.splice(0, switchStack.length, ...branchState.switchStack.map(context => ({ ...context })));
                    pendingForHeader = branchState.pendingForHeader;
                }
            }
            let structuralIndent = indentLevel + unbracedIndentDepths[i];
            let specialIndent = structuralIndent;
            if (lpcStructureIndentStack.length > 0) {
                specialIndent = lpcStructureIndentStack[lpcStructureIndentStack.length - 1];
            }
            else if (bracketStack.length > 0 && bracketStack[bracketStack.length - 1].char === '(') {
                specialIndent = bracketStack[bracketStack.length - 1].assignedIndent + 1;
            }
            const specialLineResult = this.handleSpecialLine(trimmed, indentLevel, {
                inBlockComment,
                blockCommentIndent,
                preprocessorIndentStack
            }, indentString, specialIndent);
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
                if (!inBlockComment && trimmed.startsWith('#') && !trimmed.startsWith("#'")
                    && this.endsWithLineContinuation(trimmed)) {
                    inPreprocessorContinuation = true;
                }
                if (preprocessorDirective === 'endif') {
                    preprocessorFormatStack.pop();
                }
                continue;
            }
            let currentIndent = structuralIndent;
            let leadingCloseBraceHandled = false;
            if (trimmed.startsWith('}') && !trimmed.match(/^}\s*[)\]>]/)) {
                indentLevel = Math.max(0, indentLevel - 1);
                structuralIndent = indentLevel + unbracedIndentDepths[i];
                currentIndent = structuralIndent;
                leadingCloseBraceHandled = true;
                while (switchStack.length > 0
                    && currentIndent <= switchStack[switchStack.length - 1].indentLevel) {
                    switchStack.pop();
                }
            }
            if (trimmed.match(/^[}\]>]\s*\)/) && lpcStructureIndentStack.length > 0) {
                if (lpcStructureIndentStack.length > 0) {
                    currentIndent = Math.max(0, lpcStructureIndentStack[lpcStructureIndentStack.length - 1] - 1);
                }
                else {
                    currentIndent = indentLevel;
                }
            }
            const structuralCode = this.stripCommentsAndStrings(trimmed).trim();
            if (/\bswitch(?:\s*\(|\s*$)/.test(structuralCode)) {
                switchStack.push({
                    indentLevel: currentIndent,
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
                    currentIndent = structuralIndent;
                }
                if (activeSwitch) {
                    activeSwitch.lastLineWasCaseLabel = false;
                }
            }
            else if (trimmed.startsWith(':)')) {
                const matchingParen = [...bracketStack].reverse().find(bracket => bracket.char === '(');
                currentIndent = matchingParen?.assignedIndent ?? structuralIndent;
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
                currentIndent = Math.max(structuralIndent + 1, previousCurrentIndent);
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
                        currentIndent = structuralIndent + 1;
                    }
                    else {
                        currentIndent = Math.max(structuralIndent + 1, previousCurrentIndent);
                        stringContinuationColumn = -1;
                    }
                }
                else {
                    stringContinuationColumn = -1;
                    if (isNewMappingKey && previousWasMappingValue) {
                        currentIndent = structuralIndent;
                    }
                    else {
                        currentIndent = Math.max(structuralIndent + 1, previousCurrentIndent);
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
            else if (bracketStack.length > 0
                && bracketStack[bracketStack.length - 1].char !== '{'
                && !trimmed.match(/^[)}\]>]/)) {
                const matchingParen = bracketStack[bracketStack.length - 1];
                if (matchingParen.char === '(' || matchingParen.char === '[') {
                    currentIndent = matchingParen.assignedIndent + 1;
                }
                else {
                    currentIndent = structuralIndent;
                }
                if (activeSwitch) {
                    activeSwitch.lastLineWasCaseLabel = false;
                }
            }
            else if (this.startsWithContinuationOperator(trimmed)) {
                currentIndent = structuralIndent + 1;
                if (activeSwitch) {
                    activeSwitch.lastLineWasCaseLabel = false;
                }
            }
            else if (activeSwitch) {
                activeSwitch.lastLineWasCaseLabel = false;
            }
            if (activeSwitch && !trimmed.match(/^(case\s+.*:|default\s*:)/)) {
                activeSwitch.lastLineWasCaseLabel = false;
                if (trimmed === 'break;') {
                    activeSwitch.inCaseBody = false;
                }
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
            const previousHasTernary = this.stripCommentsAndStrings(previousLine).includes('?');
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
                const previousSourceLine = this.stripCommentsAndStrings(lines[i - 1] ?? '').trim();
                const isFunctionDeclaration = LPC_FUNCTION_DECLARATION_PATTERN.test(previousSourceLine);
                if (!preprocessorContinuationLines[i - 1]
                    && (isFunctionDeclaration || this.isControlOpeningBrace(lines, i))) {
                    const previousFormattedLine = result[result.length - 1];
                    const commentIndex = this.findFirstCommentOutsideStrings(previousFormattedLine);
                    result[result.length - 1] = commentIndex >= 0
                        ? previousFormattedLine.substring(0, commentIndex).trimEnd()
                            + ' { ' + previousFormattedLine.substring(commentIndex).trimStart()
                        : previousFormattedLine + ' {';
                    mergedWithPrevLine = true;
                }
            }
            if (!mergedWithPrevLine && /^else\b/.test(finalTrimmed)) {
                let previousSourceIndex = i - 1;
                while (previousSourceIndex >= 0 && !lines[previousSourceIndex].trim()) {
                    previousSourceIndex--;
                }
                let previousResultIndex = result.length - 1;
                while (previousResultIndex >= 0 && result[previousResultIndex] === '') {
                    previousResultIndex--;
                }
                const previousResultLine = result[previousResultIndex];
                const previousIndent = previousResultLine?.match(/^[\t ]*/)?.[0] ?? '';
                if (!preprocessorContinuationLines[previousSourceIndex]
                    && previousResultLine?.trim() === '}' && previousIndent === spaces) {
                    result.length = previousResultIndex + 1;
                    result[previousResultIndex] += ' ' + finalTrimmed;
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
            if (/^(?:for|foreach)\s*$/.test(structuralCode)) {
                pendingForHeader = true;
            }
            const lineScanner = this.updateBracketStack(formattedLine, currentIndent, bracketStack, pendingForHeader);
            if (pendingForHeader && structuralCode.includes('(')) {
                pendingForHeader = false;
            }
            // Propagate block comment state when /* is opened mid-line without closing
            if (lineScanner.inBlockComment) {
                inBlockComment = true;
                blockCommentIndent = currentIndent;
            }
            const isInsideForHeader = bracketStack.some(bracket => bracket.preservesSemicolons);
            if ((trimmed.endsWith(';') || trimmed.match(/;\s*(\/\/|\/\*)/)) && !isInsideForHeader) {
                bracketStack.length = 0;
                lpcStructureIndentStack.length = 0;
            }
            const { openBraceCount, closeBraceCount, openingCount, closingCount } = this.countBracesAndStructures(trimmed, leadingCloseBraceHandled);
            const netLPCChange = openingCount - closingCount;
            const netBraces = openBraceCount - closeBraceCount;
            if (netBraces > 0) {
                indentLevel += netBraces;
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
        }
        result = this.postProcessMultiLinePatterns(result);
        return result.join('\n');
    }
    preprocessLines(lines) {
        const preprocessedLines = [];
        let inBlockComment = false;
        let inBackslashStringContinuation = false;
        let inPreprocessorContinuation = false;
        for (const originalLine of lines) {
            if (inPreprocessorContinuation) {
                preprocessedLines.push(originalLine);
                inPreprocessorContinuation = this.endsWithLineContinuation(originalLine);
                continue;
            }
            if (inBackslashStringContinuation) {
                preprocessedLines.push(originalLine);
                const continuedString = this.scanContinuedStringLine(originalLine);
                inBackslashStringContinuation = continuedString.continues;
                if (!inBackslashStringContinuation && this.hasUnclosedBlockComment(continuedString.code)) {
                    inBlockComment = true;
                }
                continue;
            }
            let line = originalLine;
            let trimmed = line.trim();
            if (!inBlockComment && trimmed.startsWith('#') && !trimmed.startsWith("#'")) {
                preprocessedLines.push(line);
                inPreprocessorContinuation = this.endsWithLineContinuation(line);
                continue;
            }
            if (inBlockComment) {
                const endPosition = line.indexOf('*/');
                if (endPosition < 0) {
                    preprocessedLines.push(line);
                    continue;
                }
                const trailingCode = line.substring(endPosition + 2).trim();
                if (!trailingCode) {
                    preprocessedLines.push(line);
                    inBlockComment = false;
                    continue;
                }
                const leadingSpaces = line.match(/^(\s*)/)?.[1] || '';
                preprocessedLines.push(line.substring(0, endPosition + 2));
                line = leadingSpaces + trailingCode;
                trimmed = line.trim();
                inBlockComment = false;
            }
            const commentPosition = this.findFirstCommentOutsideStrings(trimmed);
            if (commentPosition >= 0 && trimmed.substring(commentPosition, commentPosition + 2) === '/*'
                && trimmed.indexOf('*/', commentPosition + 2) < 0) {
                inBlockComment = true;
            }
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
                    const commentSuffix = commentPos >= 0 ? trimmed.substring(commentPos).trimStart() : '';
                    preprocessedLines.push(leadingSpaces + match[1].trim());
                    preprocessedLines.push(leadingSpaces + match[2] + (commentSuffix ? ' ' + commentSuffix : ''));
                }
                else {
                    preprocessedLines.push(line);
                }
            }
            else {
                preprocessedLines.push(line);
            }
            inBackslashStringContinuation = this.endsWithBackslashInString(line);
        }
        return preprocessedLines;
    }
    analyzeControlFlow(lines, includePreprocessorBodies = true) {
        const depths = new Array(lines.length).fill(0);
        const tokens = this.tokenizeStructuralLines(lines);
        const markLines = (startLine, endLine, depth) => {
            for (let line = startLine; line <= endLine && line < depths.length; line++) {
                depths[line] = Math.max(depths[line], depth);
            }
        };
        const findClosingParen = (openIndex) => {
            if (tokens[openIndex]?.value !== '(') {
                return openIndex;
            }
            let depth = 0;
            for (let index = openIndex; index < tokens.length; index++) {
                if (tokens[index].value === '(') {
                    depth++;
                }
                else if (tokens[index].value === ')') {
                    depth--;
                    if (depth === 0) {
                        return index;
                    }
                }
            }
            return tokens.length - 1;
        };
        let parseStatement;
        let parseSequence;
        const parseBody = (headerEnd, depth) => {
            const bodyIndex = headerEnd + 1;
            if (bodyIndex >= tokens.length) {
                return bodyIndex;
            }
            const headerLine = tokens[headerEnd].line;
            const bodyLine = tokens[bodyIndex].line;
            const isBraced = tokens[bodyIndex].value === '{';
            const bodyDepth = isBraced ? depth : depth + 1;
            if (!isBraced && bodyLine > headerLine) {
                markLines(headerLine + 1, bodyLine - 1, bodyDepth);
            }
            const nextIndex = parseStatement(bodyIndex, bodyDepth);
            if (!isBraced && bodyLine === headerLine) {
                depths[headerLine] = depth;
            }
            return nextIndex;
        };
        const parseControl = (index, depth) => {
            const openParen = index + 1;
            if (tokens[openParen]?.value !== '(') {
                return index + 1;
            }
            const headerEnd = findClosingParen(openParen);
            markLines(tokens[index].line, tokens[headerEnd].line, depth);
            let nextIndex = parseBody(headerEnd, depth);
            if (tokens[index].value !== 'if' || tokens[nextIndex]?.value !== 'else') {
                return nextIndex;
            }
            const elseIndex = nextIndex;
            const previousLine = tokens[Math.max(headerEnd, elseIndex - 1)].line;
            markLines(previousLine + 1, tokens[elseIndex].line, depth);
            depths[tokens[elseIndex].line] = Math.max(depths[tokens[elseIndex].line], depth);
            nextIndex++;
            if (tokens[nextIndex]?.value === 'if') {
                const elseLine = tokens[elseIndex].line;
                const result = parseStatement(nextIndex, depth);
                depths[elseLine] = depth;
                return result;
            }
            return parseBody(elseIndex, depth);
        };
        parseSequence = (index, depth, stopAtClosingBrace = false) => {
            while (index < tokens.length) {
                if (tokens[index].value === '}') {
                    depths[tokens[index].line] = Math.max(depths[tokens[index].line], depth);
                    if (stopAtClosingBrace) {
                        return index + 1;
                    }
                    index++;
                    continue;
                }
                const nextIndex = parseStatement(index, depth);
                index = nextIndex > index ? nextIndex : index + 1;
            }
            return index;
        };
        parseStatement = (index, depth) => {
            if (index >= tokens.length) {
                return index;
            }
            const token = tokens[index];
            if (token.value === '{') {
                const nextIndex = parseSequence(index + 1, depth, true);
                const endLine = tokens[Math.max(index, nextIndex - 1)]?.line ?? token.line;
                markLines(token.line, endLine, depth);
                return nextIndex;
            }
            if (token.value === '}') {
                return index;
            }
            if (token.value === 'if' || token.value === 'for' || token.value === 'foreach'
                || token.value === 'while' || token.value === 'switch') {
                return parseControl(index, depth);
            }
            if (token.value === 'else') {
                depths[token.line] = Math.max(depths[token.line], depth);
                if (tokens[index + 1]?.value === 'if') {
                    return parseStatement(index + 1, depth);
                }
                return parseBody(index, depth);
            }
            if (token.value === 'do') {
                depths[token.line] = Math.max(depths[token.line], depth);
                let nextIndex = parseBody(index, depth);
                if (tokens[nextIndex]?.value === 'while' && tokens[nextIndex + 1]?.value === '(') {
                    const conditionEnd = findClosingParen(nextIndex + 1);
                    markLines(tokens[nextIndex].line, tokens[conditionEnd].line, depth);
                    nextIndex = conditionEnd + 1;
                    if (tokens[nextIndex]?.value === ';') {
                        nextIndex++;
                    }
                }
                return nextIndex;
            }
            if (token.value === 'case' || token.value === 'default') {
                let parenDepth = 0;
                let endIndex = index;
                for (; endIndex < tokens.length; endIndex++) {
                    if (tokens[endIndex].value === '(') {
                        parenDepth++;
                    }
                    else if (tokens[endIndex].value === ')') {
                        parenDepth--;
                    }
                    else if (tokens[endIndex].value === ':' && parenDepth === 0) {
                        markLines(token.line, tokens[endIndex].line, depth);
                        return endIndex + 1;
                    }
                }
                return endIndex;
            }
            let parenDepth = 0;
            let endIndex = index;
            for (; endIndex < tokens.length; endIndex++) {
                const current = tokens[endIndex];
                if (current.value === '(') {
                    parenDepth++;
                }
                else if (current.value === ')') {
                    parenDepth = Math.max(0, parenDepth - 1);
                }
                else if (current.value === '{' && parenDepth === 0) {
                    markLines(token.line, current.line, depth);
                    return parseStatement(endIndex, depth);
                }
                else if (current.value === ';' && parenDepth === 0) {
                    markLines(token.line, current.line, depth);
                    return endIndex + 1;
                }
                else if (current.value === '}' && parenDepth === 0) {
                    const previousLine = tokens[Math.max(index, endIndex - 1)].line;
                    markLines(token.line, previousLine, depth);
                    return endIndex;
                }
            }
            if (tokens.length > 0) {
                markLines(token.line, tokens[tokens.length - 1].line, depth);
            }
            return endIndex;
        };
        parseSequence(0, 0);
        if (includePreprocessorBodies) {
            this.applyPreprocessorControlDepths(lines, depths);
        }
        return depths;
    }
    applyPreprocessorControlDepths(lines, depths) {
        const preprocessor = this.analyzePreprocessorLines(lines);
        const continuationLines = preprocessor.continuationLines;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            if (continuationLines[lineIndex]) {
                continue;
            }
            const openingDirective = preprocessor.directives[lineIndex];
            if (openingDirective !== 'if' && openingDirective !== 'ifdef'
                && openingDirective !== 'ifndef') {
                continue;
            }
            const precedingTokens = this.tokenizeStructuralLines(lines.slice(0, lineIndex));
            const headerEnd = precedingTokens[precedingTokens.length - 1]?.line ?? -1;
            if (continuationLines[headerEnd]) {
                continue;
            }
            const isControlBody = this.isControlHeaderEndingAt(lines, headerEnd);
            const branches = [];
            let branchStart = lineIndex + 1;
            let conditionalDepth = 0;
            let closingDirective = -1;
            for (let cursor = lineIndex; cursor < lines.length; cursor++) {
                const directive = preprocessor.directives[cursor];
                if (directive === 'if' || directive === 'ifdef' || directive === 'ifndef') {
                    conditionalDepth++;
                }
                else if (directive === 'endif') {
                    conditionalDepth--;
                    if (conditionalDepth === 0) {
                        branches.push({ start: branchStart, end: cursor });
                        closingDirective = cursor;
                        break;
                    }
                }
                else if ((directive === 'else' || directive === 'elif') && conditionalDepth === 1) {
                    branches.push({ start: branchStart, end: cursor });
                    branchStart = cursor + 1;
                }
            }
            if (closingDirective < 0) {
                continue;
            }
            const parentDepth = isControlBody ? depths[headerEnd] : depths[lineIndex];
            const pendingHeaders = [];
            const analyzedBranches = [];
            let allBranchesAnalyzable = true;
            for (const branch of branches) {
                const branchLines = lines.slice(branch.start, branch.end);
                const structuralBranchLines = branchLines.map((line, offset) => continuationLines[branch.start + offset] ? '' : line);
                const branchTokens = this.tokenizeStructuralLines(structuralBranchLines);
                if (branchTokens.length === 0) {
                    allBranchesAnalyzable = false;
                    continue;
                }
                const branchVariants = this.expandPreprocessorVariants(structuralBranchLines);
                if (branchVariants.length === 0) {
                    allBranchesAnalyzable = false;
                }
                else {
                    analyzedBranches.push(...branchVariants);
                }
                const bodyDepth = parentDepth
                    + (isControlBody && branchTokens[0].value !== '{' ? 1 : 0);
                const branchDepths = this.analyzeControlFlow(structuralBranchLines, false);
                for (let offset = 0; offset < branchLines.length; offset++) {
                    if (!continuationLines[branch.start + offset]) {
                        depths[branch.start + offset] = bodyDepth + branchDepths[offset];
                    }
                }
                const lastTokenLine = branchTokens[branchTokens.length - 1].line;
                const headerStart = this.findControlHeaderStart(structuralBranchLines, lastTokenLine);
                if (headerStart >= 0) {
                    pendingHeaders.push({
                        lines: structuralBranchLines.slice(headerStart, lastTokenLine + 1),
                        depth: bodyDepth + branchDepths[lastTokenLine]
                    });
                }
            }
            if (pendingHeaders.length === branches.length && pendingHeaders.length > 0) {
                const pendingHeader = pendingHeaders.reduce((shallowest, current) => current.depth < shallowest.depth ? current : shallowest);
                const tailLines = lines.slice(closingDirective + 1);
                const syntheticLines = [...pendingHeader.lines, ...tailLines];
                const statementEnd = this.findFirstStatementEndLine(syntheticLines);
                const syntheticDepths = this.analyzeControlFlow(syntheticLines, false);
                for (let syntheticLine = pendingHeader.lines.length; syntheticLine <= statementEnd; syntheticLine++) {
                    const sourceLine = closingDirective + 1
                        + syntheticLine - pendingHeader.lines.length;
                    if (sourceLine < lines.length) {
                        depths[sourceLine] = pendingHeader.depth + syntheticDepths[syntheticLine];
                    }
                }
            }
            const enclosingHeaderStart = isControlBody
                ? this.findControlHeaderStart(lines, headerEnd)
                : -1;
            const enclosingHeaderLines = enclosingHeaderStart >= 0
                ? lines.slice(enclosingHeaderStart, headerEnd + 1)
                : [];
            const tailLines = lines.slice(closingDirective + 1);
            const tailTokens = this.tokenizeStructuralLines(tailLines);
            const enclosingTokens = this.tokenizeStructuralLines(enclosingHeaderLines);
            const hasEnclosingIf = enclosingTokens[0]?.value === 'if'
                || (enclosingTokens[0]?.value === 'else' && enclosingTokens[1]?.value === 'if');
            if (allBranchesAnalyzable && analyzedBranches.length > 0
                && tailTokens[0]?.value === 'else'
                && hasEnclosingIf) {
                const tailDepthsByBranch = analyzedBranches.map(branchLines => {
                    const syntheticLines = [...enclosingHeaderLines, ...branchLines, ...tailLines];
                    const statementEnd = this.findFirstStatementEndLine(syntheticLines);
                    const syntheticDepths = this.analyzeControlFlow(syntheticLines, false);
                    const tailStart = enclosingHeaderLines.length + branchLines.length;
                    return tailLines.map((_line, offset) => {
                        const syntheticLine = tailStart + offset;
                        return syntheticLine <= statementEnd
                            ? syntheticDepths[syntheticLine]
                            : undefined;
                    });
                });
                for (let offset = 0; offset < tailLines.length; offset++) {
                    const branchDepths = tailDepthsByBranch.map(branchDepths => branchDepths[offset]);
                    const commonDepth = branchDepths[0];
                    if (commonDepth !== undefined
                        && branchDepths.every(branchDepth => branchDepth === commonDepth)) {
                        depths[closingDirective + 1 + offset] = parentDepth + commonDepth;
                    }
                }
            }
        }
    }
    analyzePreprocessorLines(lines) {
        const continuationLines = new Array(lines.length).fill(false);
        const directives = new Array(lines.length).fill(undefined);
        let inDirectiveContinuation = false;
        let inBlockComment = false;
        let inContinuedString = false;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            continuationLines[lineIndex] = inDirectiveContinuation;
            if (inDirectiveContinuation) {
                inDirectiveContinuation = this.endsWithLineContinuation(line);
                continue;
            }
            if (inContinuedString) {
                const continuedString = this.scanContinuedStringLine(line);
                inContinuedString = continuedString.continues;
                if (!inContinuedString && this.hasUnclosedBlockComment(continuedString.code)) {
                    inBlockComment = true;
                }
                continue;
            }
            if (inBlockComment) {
                const endPosition = line.indexOf('*/');
                if (endPosition < 0) {
                    continue;
                }
                inBlockComment = false;
            }
            const trimmed = line.trimStart();
            if (/^#(?!')/.test(trimmed)) {
                const directive = trimmed.match(/^#\s*(if|ifdef|ifndef|elif|else|endif)\b/)?.[1];
                directives[lineIndex] = directive;
                inDirectiveContinuation = this.endsWithLineContinuation(line);
                continue;
            }
            const commentPosition = this.findFirstCommentOutsideStrings(line);
            if (commentPosition >= 0 && line.substring(commentPosition, commentPosition + 2) === '/*'
                && line.indexOf('*/', commentPosition + 2) < 0) {
                inBlockComment = true;
            }
            inContinuedString = this.endsWithBackslashInString(line);
        }
        return { continuationLines, directives };
    }
    expandPreprocessorVariants(lines, maxVariants = 32) {
        const preprocessor = this.analyzePreprocessorLines(lines);
        const isOpeningDirective = (directive) => directive === 'if' || directive === 'ifdef' || directive === 'ifndef';
        const sanitizeRange = (start, end) => lines.slice(start, end).map((line, offset) => preprocessor.continuationLines[start + offset] ? '' : line);
        const expandRange = (start, end) => {
            let opening = -1;
            for (let lineIndex = start; lineIndex < end; lineIndex++) {
                if (isOpeningDirective(preprocessor.directives[lineIndex])) {
                    opening = lineIndex;
                    break;
                }
            }
            if (opening < 0) {
                return [sanitizeRange(start, end)];
            }
            const branches = [];
            let branchStart = opening + 1;
            let depth = 0;
            let closing = -1;
            let hasElseBranch = false;
            for (let lineIndex = opening; lineIndex < end; lineIndex++) {
                const directive = preprocessor.directives[lineIndex];
                if (isOpeningDirective(directive)) {
                    depth++;
                }
                else if (directive === 'endif') {
                    depth--;
                    if (depth === 0) {
                        branches.push({ start: branchStart, end: lineIndex });
                        closing = lineIndex;
                        break;
                    }
                }
                else if ((directive === 'elif' || directive === 'else') && depth === 1) {
                    branches.push({ start: branchStart, end: lineIndex });
                    branchStart = lineIndex + 1;
                    hasElseBranch || (hasElseBranch = directive === 'else');
                }
            }
            if (closing < 0) {
                return [sanitizeRange(start, end)];
            }
            const branchVariants = [];
            for (const branch of branches) {
                const variants = expandRange(branch.start, branch.end);
                if (variants.length === 0) {
                    return [];
                }
                for (const variant of variants) {
                    branchVariants.push({ start: branch.start, lines: variant });
                    if (branchVariants.length > maxVariants) {
                        return [];
                    }
                }
            }
            if (!hasElseBranch) {
                branchVariants.push({ start: opening + 1, lines: [] });
            }
            const suffixVariants = expandRange(closing + 1, end);
            if (suffixVariants.length === 0) {
                return [];
            }
            const prefix = sanitizeRange(start, opening);
            const variants = [];
            for (const branch of branchVariants) {
                for (const suffix of suffixVariants) {
                    const variant = new Array(end - start).fill('');
                    prefix.forEach((line, offset) => {
                        variant[offset] = line;
                    });
                    branch.lines.forEach((line, offset) => {
                        variant[branch.start - start + offset] = line;
                    });
                    suffix.forEach((line, offset) => {
                        variant[closing + 1 - start + offset] = line;
                    });
                    variants.push(variant);
                    if (variants.length > maxVariants) {
                        return [];
                    }
                }
            }
            return variants;
        };
        return expandRange(0, lines.length);
    }
    tokenizeStructuralLines(lines) {
        const tokens = [];
        let inBlockComment = false;
        let inContinuedString = false;
        let inPreprocessorContinuation = false;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const trimmed = line.trimStart();
            if (inPreprocessorContinuation) {
                inPreprocessorContinuation = this.endsWithLineContinuation(line);
                continue;
            }
            if (!inBlockComment && !inContinuedString
                && trimmed.startsWith('#') && !trimmed.startsWith("#'")) {
                inPreprocessorContinuation = this.endsWithLineContinuation(line);
                continue;
            }
            let inString = inContinuedString;
            let stringDelimiter = inContinuedString ? '"' : null;
            let escaped = false;
            for (let index = 0; index < line.length; index++) {
                const char = line[index];
                const nextChar = index + 1 < line.length ? line[index + 1] : '';
                if (inBlockComment) {
                    if (char === '*' && nextChar === '/') {
                        inBlockComment = false;
                        index++;
                    }
                    continue;
                }
                if (inString) {
                    if (escaped) {
                        escaped = false;
                    }
                    else if (char === '\\') {
                        escaped = true;
                    }
                    else if (char === stringDelimiter) {
                        inString = false;
                        stringDelimiter = null;
                    }
                    continue;
                }
                if (char === '/' && nextChar === '/') {
                    break;
                }
                if (char === '/' && nextChar === '*') {
                    inBlockComment = true;
                    index++;
                    continue;
                }
                if (char === '"') {
                    inString = true;
                    stringDelimiter = '"';
                    continue;
                }
                if (char === "'" && this.isCharacterLiteralAt(line, index)) {
                    inString = true;
                    stringDelimiter = "'";
                    continue;
                }
                if (/[A-Za-z_]/.test(char)) {
                    let end = index + 1;
                    while (end < line.length && /\w/.test(line[end])) {
                        end++;
                    }
                    tokens.push({ value: line.substring(index, end), line: lineIndex });
                    index = end - 1;
                    continue;
                }
                if ('(){};:'.includes(char)) {
                    if (char === '}' && nextChar === ')') {
                        continue;
                    }
                    tokens.push({ value: char, line: lineIndex });
                }
            }
            inContinuedString = inString && stringDelimiter === '"' && this.endsWithLineContinuation(line);
        }
        return tokens;
    }
    handleSpecialLine(trimmed, indentLevel, state, indentString = '    ', contentIndentLevel = indentLevel) {
        if (!state.inBlockComment && trimmed.startsWith('#') && !trimmed.startsWith("#'")) {
            let newIndentLevel;
            const directive = trimmed.match(/^#\s*(if|ifdef|ifndef|elif|else|endif)\b/)?.[1];
            if (directive === 'if' || directive === 'ifdef' || directive === 'ifndef') {
                state.preprocessorIndentStack.push(indentLevel);
            }
            else if (directive === 'else' || directive === 'elif') {
                if (state.preprocessorIndentStack.length > 0) {
                    newIndentLevel = state.preprocessorIndentStack[state.preprocessorIndentStack.length - 1];
                }
            }
            else if (directive === 'endif' && state.preprocessorIndentStack.length > 0) {
                state.preprocessorIndentStack.pop();
            }
            const commentPosition = this.findFirstCommentOutsideStrings(trimmed);
            const opensBlockComment = commentPosition >= 0
                && trimmed.substring(commentPosition, commentPosition + 2) === '/*'
                && trimmed.indexOf('*/', commentPosition + 2) < 0;
            return {
                handled: true,
                output: trimmed,
                inBlockComment: opensBlockComment ? true : undefined,
                blockCommentIndent: opensBlockComment ? 0 : undefined,
                updateIndentLevel: newIndentLevel
            };
        }
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
            if (endPos >= 0 && trimmed.lastIndexOf('*/') === trimmed.length - 2) {
                const spaces = indentString.repeat(contentIndentLevel);
                return {
                    handled: true,
                    output: spaces + trimmed
                };
            }
            if (endPos === -1) {
                const spaces = indentString.repeat(contentIndentLevel);
                const afterComment = trimmed.substring(startPos + 2).trim();
                if (afterComment.length > 0) {
                    return {
                        handled: true,
                        output: [spaces + '/*', spaces + ' * ' + afterComment],
                        inBlockComment: true,
                        blockCommentIndent: contentIndentLevel
                    };
                }
                else {
                    return {
                        handled: true,
                        output: spaces + '/*',
                        inBlockComment: true,
                        blockCommentIndent: contentIndentLevel
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
                inBlockComment: !isClosing
            };
        }
        if (trimmed.startsWith('//')) {
            const spaces = indentString.repeat(contentIndentLevel);
            return {
                handled: true,
                output: spaces + trimmed
            };
        }
        if (!trimmed) {
            return {
                handled: true,
                output: ''
            };
        }
        return { handled: false };
    }
    normalizeSpacing(code) {
        let normalized = this.replaceOutsideProtectedText(code, /,\s{2,}/g, ', ');
        normalized = this.replaceOutsideProtectedText(normalized, /\b([A-Za-z_]\w*)\s+\(/g, (_match, identifier) => /^(?:if|for|foreach|while|switch|return)$/.test(identifier)
            ? `${identifier} (`
            : `${identifier}(`);
        normalized = this.replaceOutsideProtectedText(normalized, /\b(if|for|foreach|while|switch)\s*\(/g, '$1 (');
        normalized = this.replaceOutsideProtectedText(normalized, /\s*->\s*/g, '->');
        normalized = this.replaceOutsideProtectedText(normalized, /\(\s+(?!\(\{)/g, '(');
        normalized = this.replaceOutsideProtectedText(normalized, new RegExp(`\\((${LPC_DECLARATION_TYPE_PATTERN})(\\s*\\*)?\\)\\s+([A-Za-z_(])`, 'g'), '($1$2)$3');
        // Remove extra spaces before closing parens, semicolons, braces
        normalized = this.replaceOutsideProtectedText(normalized, /\s{2,}([);{])/g, ' $1');
        normalized = this.replaceOutsideProtectedText(normalized, /\s+;/g, ';');
        const structuralCode = this.stripCommentsAndStrings(normalized);
        const hasMultipleClosingParens = structuralCode.includes('}));') ||
            /\}\)\s*\)\s*\)/.test(structuralCode) ||
            /\}\)\s*\)\s*;/.test(structuralCode);
        if (!hasMultipleClosingParens && (structuralCode.match(/\}\s*\)/g) || []).length < 2) {
            normalized = this.replaceOutsideProtectedText(normalized, /\}\)\s+\)/g, '}))');
        }
        normalized = this.replaceOutsideProtectedText(normalized, new RegExp(`\\b(${LPC_TYPE_PATTERN})\\s{2,}`, 'g'), '$1 ');
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
    isControlOpeningBrace(lines, braceLine) {
        if (braceLine <= 0 || lines[braceLine - 1].trim().length === 0) {
            return false;
        }
        const previousLine = this.stripCommentsAndStrings(lines[braceLine - 1]).trim();
        if (previousLine === 'else' || previousLine === 'do') {
            return true;
        }
        return this.isControlHeaderEndingAt(lines, braceLine - 1);
    }
    findFirstStatementEndLine(lines) {
        const tokens = this.tokenizeStructuralLines(lines);
        if (tokens.length === 0) {
            return -1;
        }
        const findClosingParen = (openIndex) => {
            let depth = 0;
            for (let index = openIndex; index < tokens.length; index++) {
                if (tokens[index].value === '(') {
                    depth++;
                }
                else if (tokens[index].value === ')' && --depth === 0) {
                    return index;
                }
            }
            return tokens.length - 1;
        };
        const skipBlock = (openIndex) => {
            let depth = 0;
            for (let index = openIndex; index < tokens.length; index++) {
                if (tokens[index].value === '{') {
                    depth++;
                }
                else if (tokens[index].value === '}' && --depth === 0) {
                    return index + 1;
                }
            }
            return tokens.length;
        };
        let skipStatement;
        const skipBody = (headerEnd) => {
            return headerEnd + 1 < tokens.length
                ? skipStatement(headerEnd + 1)
                : headerEnd + 1;
        };
        skipStatement = (index) => {
            if (index >= tokens.length) {
                return index;
            }
            const token = tokens[index].value;
            if (token === '{') {
                return skipBlock(index);
            }
            if ((token === 'if' || token === 'for' || token === 'foreach'
                || token === 'while' || token === 'switch')
                && tokens[index + 1]?.value === '(') {
                const conditionEnd = findClosingParen(index + 1);
                let nextIndex = skipBody(conditionEnd);
                if (token === 'if' && tokens[nextIndex]?.value === 'else') {
                    nextIndex = skipBody(nextIndex);
                }
                return nextIndex;
            }
            if (token === 'do') {
                let nextIndex = skipBody(index);
                if (tokens[nextIndex]?.value === 'while' && tokens[nextIndex + 1]?.value === '(') {
                    nextIndex = findClosingParen(nextIndex + 1) + 1;
                    if (tokens[nextIndex]?.value === ';') {
                        nextIndex++;
                    }
                }
                return nextIndex;
            }
            if (token === 'else') {
                return skipBody(index);
            }
            let parenDepth = 0;
            for (let cursor = index; cursor < tokens.length; cursor++) {
                if (tokens[cursor].value === '(') {
                    parenDepth++;
                }
                else if (tokens[cursor].value === ')') {
                    parenDepth = Math.max(0, parenDepth - 1);
                }
                else if (tokens[cursor].value === '{' && parenDepth === 0) {
                    return skipBlock(cursor);
                }
                else if (tokens[cursor].value === ';' && parenDepth === 0) {
                    return cursor + 1;
                }
                else if (tokens[cursor].value === '}' && parenDepth === 0) {
                    return cursor;
                }
            }
            return tokens.length;
        };
        const nextIndex = skipStatement(0);
        return tokens[Math.max(0, Math.min(tokens.length - 1, nextIndex - 1))].line;
    }
    isControlHeaderEndingAt(lines, endLine) {
        return this.findControlHeaderStart(lines, endLine) >= 0;
    }
    findControlHeaderStart(lines, endLine) {
        if (endLine < 0) {
            return -1;
        }
        const tokens = this.tokenizeStructuralLines(lines.slice(0, endLine + 1));
        const lastTokenIndex = tokens.length - 1;
        if (lastTokenIndex < 0) {
            return -1;
        }
        if (tokens[lastTokenIndex].line !== endLine) {
            return -1;
        }
        if (tokens[lastTokenIndex].value === 'do') {
            return tokens[lastTokenIndex].line;
        }
        if (tokens[lastTokenIndex].value !== ')') {
            return -1;
        }
        let balance = 0;
        for (let tokenIndex = lastTokenIndex; tokenIndex >= 0; tokenIndex--) {
            const value = tokens[tokenIndex].value;
            if (value === ')') {
                balance++;
            }
            else if (value === '(' && --balance === 0) {
                const controlIndex = tokenIndex - 1;
                const control = tokens[controlIndex];
                if (!control || !/^(?:if|for|foreach|while|switch)$/.test(control.value)) {
                    return -1;
                }
                const elseToken = control.value === 'if' ? tokens[controlIndex - 1] : undefined;
                return elseToken?.value === 'else' ? elseToken.line : control.line;
            }
        }
        return -1;
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
    updateBracketStack(line, currentIndent, bracketStack, preserveFirstParen = false) {
        const scanner = new CharacterScanner();
        for (let column = 0; column < line.length; column++) {
            const { skip, skipNext } = scanner.processChar(line, column);
            if (skipNext) {
                column++;
            }
            if (skip) {
                continue;
            }
            const char = line[column];
            const nextChar = column + 1 < line.length ? line[column + 1] : '';
            const previousChar = column > 0 ? line[column - 1] : '';
            if (char === '(' && (nextChar === '{' || nextChar === '[' || nextChar === '<')) {
                bracketStack.push({ char: '(', assignedIndent: currentIndent });
                column++;
                continue;
            }
            if ((char === '}' || char === ']' || char === '>') && nextChar === ')') {
                if (bracketStack[bracketStack.length - 1]?.char === '(') {
                    bracketStack.pop();
                }
                column++;
                continue;
            }
            if (char === ')' && (previousChar === '}' || previousChar === ']' || previousChar === '>')) {
                continue;
            }
            if (char === '[' && column >= 2 && line[column - 1] === '\'' && line[column - 2] === '#') {
                continue;
            }
            if (char === '(' || char === '[' || char === '{') {
                const prefix = char === '('
                    ? this.stripCommentsAndStrings(line.substring(0, column)).trim()
                    : '';
                bracketStack.push({
                    char,
                    assignedIndent: currentIndent,
                    preservesSemicolons: char === '('
                        && (preserveFirstParen || /^(?:for|foreach)\s*$/.test(prefix))
                });
                if (char === '(') {
                    preserveFirstParen = false;
                }
            }
            else if (char === ')' || char === ']' || char === '}') {
                const last = bracketStack[bracketStack.length - 1];
                if (last && ((char === ')' && last.char === '(')
                    || (char === ']' && last.char === '[')
                    || (char === '}' && last.char === '{'))) {
                    bracketStack.pop();
                }
            }
        }
        return scanner;
    }
    countBracesAndStructures(trimmed, leadingCloseBraceHandled) {
        let openBraceCount = 0;
        let closeBraceCount = 0;
        let openingCount = 0;
        let closingCount = 0;
        const scanner = new CharacterScanner();
        for (let i = 0; i < trimmed.length; i++) {
            const { skip, skipNext } = scanner.processChar(trimmed, i);
            if (skipNext)
                i++;
            if (skip)
                continue;
            const char = trimmed[i];
            const nextChar = i + 1 < trimmed.length ? trimmed[i + 1] : '';
            const prevChar = i > 0 ? trimmed[i - 1] : '';
            // LPC structure openers: ({, ([, (<
            if (char === '(' && (nextChar === '{' || nextChar === '[' || nextChar === '<')) {
                openingCount++;
                i++; // Skip the {/[/<
                continue;
            }
            // LPC structure closers: }), ]), >)
            if ((char === '}' || char === ']' || char === '>') && nextChar === ')') {
                closingCount++;
                i++; // Skip the )
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
            }
            else if (char === '}') {
                if (i === 0 && leadingCloseBraceHandled) {
                    continue;
                }
                closeBraceCount++;
            }
        }
        return { openBraceCount, closeBraceCount, openingCount, closingCount };
    }
    isInsideString(line, position) {
        const scanner = new CharacterScanner();
        for (let i = 0; i < position; i++) {
            const { skipNext } = scanner.processChar(line, i);
            if (skipNext) {
                i++;
            }
        }
        return scanner.inString;
    }
    findFirstCommentOutsideStrings(line) {
        return this.findFirstComment(line, false);
    }
    findFirstLineCommentOutsideStrings(line) {
        return this.findFirstComment(line, true);
    }
    findFirstComment(line, lineCommentsOnly) {
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
    endsWithLineContinuation(line) {
        const trimmed = line.trimEnd();
        let backslashCount = 0;
        for (let index = trimmed.length - 1; index >= 0 && trimmed[index] === '\\'; index--) {
            backslashCount++;
        }
        return backslashCount % 2 === 1;
    }
    scanContinuedStringLine(line) {
        let code = '';
        let inString = true;
        let escaped = false;
        for (let index = 0; index < line.length; index++) {
            const char = line[index];
            if (inString) {
                code += ' ';
                if (escaped) {
                    escaped = false;
                }
                else if (char === '\\') {
                    escaped = true;
                }
                else if (char === '"') {
                    inString = false;
                }
            }
            else if (char === '"') {
                code += ' ';
                inString = true;
                escaped = false;
            }
            else {
                code += char;
            }
        }
        return {
            code,
            continues: inString && this.endsWithLineContinuation(line)
        };
    }
    hasUnclosedBlockComment(line) {
        const scanner = new CharacterScanner();
        for (let index = 0; index < line.length; index++) {
            const { skipNext } = scanner.processChar(line, index);
            if (skipNext) {
                index++;
            }
        }
        return scanner.inBlockComment;
    }
    isCharacterLiteralAt(line, index) {
        if (line[index + 1] === '\\') {
            return index + 3 < line.length && line[index + 3] === "'";
        }
        return index + 2 < line.length && line[index + 2] === "'";
    }
    computeProtectedMask(line, scanner = new CharacterScanner()) {
        const mask = new Array(line.length).fill(false);
        scanner.startLine();
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
    rangeTouchesProtectedText(mask, start, length) {
        for (let i = start; i < start + length; i++) {
            if (mask[i]) {
                return true;
            }
        }
        return false;
    }
    replaceOutsideProtectedText(line, pattern, replacement) {
        let result = '';
        let lastIndex = 0;
        const matches = [];
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(line)) !== null) {
            matches.push({ index: match.index, match });
        }
        if (matches.length === 0) {
            return line;
        }
        const mask = this.computeProtectedMask(line);
        for (const { index, match } of matches) {
            result += line.substring(lastIndex, index);
            if (!this.rangeTouchesProtectedText(mask, index, match[0].length)) {
                if (typeof replacement === 'function') {
                    result += replacement(match[0], ...match.slice(1));
                }
                else {
                    result += match[0].replace(pattern, replacement);
                }
            }
            else {
                result += match[0];
            }
            lastIndex = index + match[0].length;
        }
        result += line.substring(lastIndex);
        return result;
    }
    postProcessMultiLinePatterns(lines) {
        const processed = [];
        let lambdaParenDepth = 0;
        let inPreprocessorContinuation = false;
        const analysisScanner = new CharacterScanner();
        const isClosureContent = (content) => {
            const trimmedContent = content.trim();
            if (trimmedContent.includes("#'") || trimmedContent.match(/'\w+/) || trimmedContent.includes('lambda')) {
                return true;
            }
            return false;
        };
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            const lineStartScanner = analysisScanner.clone();
            if (inPreprocessorContinuation) {
                inPreprocessorContinuation = this.endsWithLineContinuation(line);
                processed.push(line);
                continue;
            }
            if (!lineStartScanner.inString && !lineStartScanner.inBlockComment
                && /^#(?!')/.test(line.trimStart())) {
                inPreprocessorContinuation = this.endsWithLineContinuation(line);
                processed.push(line);
                continue;
            }
            const analysisLine = this.stripCommentsAndStringsWithScanner(line, analysisScanner);
            const lambdaIndex = analysisLine.indexOf('lambda(');
            if (lambdaParenDepth > 0 || lambdaIndex >= 0) {
                const lambdaText = lambdaParenDepth > 0
                    ? analysisLine
                    : analysisLine.substring(lambdaIndex + 'lambda'.length);
                lambdaParenDepth += this.countParenthesisDelta(lambdaText);
                processed.push(line);
                if (lambdaParenDepth < 0) {
                    lambdaParenDepth = 0;
                }
                continue;
            }
            const typedClosureMask = this.computeProtectedMask(line, lineStartScanner.clone());
            line = line.replace(new RegExp(`\\(\\{\\s*(${LPC_TYPE_PATTERN})(\\*?)\\s*\\}\\)`, 'g'), (match, type, star, offset) => {
                return this.rangeTouchesProtectedText(typedClosureMask, offset, match.length)
                    ? match
                    : `({${type}${star}})`;
            });
            const trimmed = analysisLine.trim();
            const protectedMask = this.computeProtectedMask(line, lineStartScanner);
            const closureEndCount = (analysisLine.match(/\}\s*\)/g) || []).length;
            const hasMultipleClosures = closureEndCount >= 2;
            const hasClosureIndicators = analysisLine.includes('#\'') || trimmed.startsWith('({#\'');
            const hasDoubleClosingParens = analysisLine.includes('}));');
            if (hasMultipleClosures || hasClosureIndicators || hasDoubleClosingParens) {
                processed.push(line);
            }
            else {
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
    countParenthesisDelta(line) {
        let delta = 0;
        for (const char of line) {
            if (char === '(') {
                delta++;
            }
            else if (char === ')') {
                delta--;
            }
        }
        return delta;
    }
    needsContinuation(line) {
        const trimmedLine = this.stripCommentsAndStrings(line).trimEnd();
        if (/^\s*(?:\/\/|\/\*)/.test(line) && trimmedLine.length === 0) {
            return false;
        }
        if (trimmedLine.endsWith('{')) {
            return false;
        }
        if (trimmedLine.endsWith(';')) {
            return false;
        }
        if (LPC_SPLIT_POINTER_RETURN_PATTERN.test(trimmedLine)) {
            return false;
        }
        if (this.hasUnclosedBrackets(trimmedLine)) {
            return true;
        }
        const castAtEnd = new RegExp(`\\((?:${LPC_DECLARATION_TYPE_PATTERN})\\s*\\*?\\)\\s*$`);
        if (castAtEnd.test(trimmedLine)) {
            return true;
        }
        if (/(?:\+\+|--)\s*$/.test(trimmedLine)) {
            return false;
        }
        if (/(?:->|&&|\|\||==|!=|<=|>=|<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|[=+\-*/%&|^<>?:])\s*$/.test(trimmedLine)
            && !trimmedLine.match(/^\s*(case\s+|default\s*:)/)) {
            return true;
        }
        if (trimmedLine.endsWith(',')) {
            return true;
        }
        return false;
    }
    startsWithContinuationOperator(line) {
        return /^(?:&&|\|\||->|==|!=|<=|>=|<<|>>|\+(?!\+)|\/(?![/*])|[%&|^?]|:(?!:))/.test(line);
    }
    hasUnclosedBrackets(line) {
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
        return this.stripCommentsAndStringsWithScanner(line, new CharacterScanner());
    }
    stripCommentsAndStringsWithScanner(line, scanner) {
        let result = '';
        scanner.startLine();
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
}
exports.LPCDocumentFormattingEditProvider = LPCDocumentFormattingEditProvider;
//# sourceMappingURL=formatProvider.js.map