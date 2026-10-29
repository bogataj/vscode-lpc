interface BracketInfo {
    char: string;
    assignedIndent: number;
    preservesSemicolons?: boolean;
}

interface StructuralToken {
    value: string;
    line: number;
}

type LPCStructureDelimiter = '}' | ']' | '>';

interface SpacingToken {
    text: string;
    kind: 'word' | 'number' | 'operand' | 'comment' | 'punct';
    /** Whitespace that preceded the token in the source line. */
    space: string;
}

interface SpacingFrame {
    kind: 'root' | 'paren' | 'index' | 'brace' | 'array' | 'mapping' | 'multiset' | 'struct' | 'closure';
    pendingTernaries: number;
    pendingCase: boolean;
    foreachHeader: boolean;
}

interface SpecialLineResult {
    handled: boolean;
    output?: string | string[];
    inBlockComment?: boolean;
    blockCommentIndent?: number;
    updateIndentLevel?: number;
}

interface SwitchContext {
    indentLevel: number;
    lastLineWasCaseLabel: boolean;
    inCaseBody: boolean;
}

interface PreprocessorFormatContext {
    previousLineNeedsContinuation: boolean;
    previousCurrentIndent: number;
    stringContinuationColumn: number;
    stringContinuationPrefix: string;
    lpcDataStructureDepth: number;
    bracketStack: BracketInfo[];
    lpcStructureIndentStack: number[];
    lpcStructureStack: LPCStructureDelimiter[];
    switchStack: SwitchContext[];
    pendingForHeader: boolean;
}

type PreprocessorDirective = 'if' | 'ifdef' | 'ifndef' | 'elif' | 'else' | 'endif';

interface PreprocessorLineInfo {
    continuationLines: boolean[];
    lineCommentContinuationLines: boolean[];
    directives: Array<PreprocessorDirective | undefined>;
}

const LPC_SIMPLE_TYPE_PATTERN = 'void|int|float|string|object|mapping|mixed|status|closure|symbol|bytes|lwobject|coroutine|lpctype';
const LPC_TYPE_PATTERN = `${LPC_SIMPLE_TYPE_PATTERN}|struct`;
const LPC_NAMED_TYPE_PATTERN = `(?:${LPC_SIMPLE_TYPE_PATTERN}|struct(?:\\s+[A-Za-z_]\\w*)?)`;
const LPC_DECLARATION_TYPE_MEMBER_PATTERN = `${LPC_NAMED_TYPE_PATTERN}\\*?`;
const LPC_DECLARATION_TYPE_PATTERN =
    `${LPC_DECLARATION_TYPE_MEMBER_PATTERN}(?:\\s*\\|\\s*${LPC_DECLARATION_TYPE_MEMBER_PATTERN})*`;
const LPC_MODIFIER_PATTERN = 'async|static|private|protected|public|nomask|deprecated|varargs|virtual|nosave';
const LPC_FUNCTION_DECLARATION_PATTERN = new RegExp(
    `^(?:(?:${LPC_MODIFIER_PATTERN})\\s+)*(?:${LPC_DECLARATION_TYPE_PATTERN})\\s+(?:\\*+\\s*)?\\w+\\s*\\([^)]*\\)\\s*$`
);
const LPC_SPLIT_POINTER_RETURN_PATTERN = new RegExp(
    `^(?:(?:${LPC_MODIFIER_PATTERN})\\s+)*(?:${LPC_DECLARATION_TYPE_PATTERN})\\s+\\*+\\s*$`
);
// Operator spacing follows common C style, since LPC has no style guide of its own.
const SPACING_PUNCTUATORS = [
    '>>>=', '<<=', '>>=', '&&=', '||=', '>>>', '...', '->', '::', '..', '++', '--', '==', '!=', '<=', '>=',
    '<<', '>>', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '({', '([', '(<', '(:', ':)'
];
const SPACED_BINARY_OPERATORS = new Set([
    '=', '==', '!=', '<', '>', '<=', '>=', '<<', '>>', '>>>', '&&', '||', '&', '|', '^', '+', '-', '/', '%',
    '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>=', '&&=', '||='
]);
const KEYWORDS_BEFORE_OPERAND = new Set(['return', 'case', 'else', 'do', 'yield', 'await', 'throw']);
const LPC_TYPE_WORDS = new Set([...LPC_SIMPLE_TYPE_PATTERN.split('|'), 'struct']);
const CLOSURE_REFERENCE = /^#'(?:\[\.\.|\[|[?=!<>+\-*/%&|^~.]+|[A-Za-z_]\w*(?:::[A-Za-z_]\w*)?)/;
const NUMBER_LITERAL = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|(?:\d+(?:\.(?!\.)\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/;

// Prevents binary +/- spacing from splitting the exponent of a float literal such as 1.5e-3.
const NOT_FLOAT_EXPONENT_SIGN = '(?!(?<=(?:^|[^\\w.])(?:\\d+(?:\\.\\d*)?|\\.\\d+))[eE][+-]\\d)';
const LPC_TYPE_WITH_OPTIONAL_POINTER_PATTERN = new RegExp(`^(?:${LPC_DECLARATION_TYPE_PATTERN})\\*?$`);

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

    startLine(): void {
        this.inLineComment = false;
    }

    clone(): CharacterScanner {
        const scanner = new CharacterScanner();
        scanner.inString = this.inString;
        scanner.inLineComment = this.inLineComment;
        scanner.inBlockComment = this.inBlockComment;
        scanner.stringDelimiter = this.stringDelimiter;
        return scanner;
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

export interface LPCFormatOptions {
    insertSpaces: boolean;
    tabSize: number;
    /** Collapse functions whose body is one simple statement onto one line (default true). */
    compactSingleStatementFunctions?: boolean;
}

export interface FormatCancellation {
    readonly isCancellationRequested: boolean;
}

/**
 * LPC formatting engine. It has no VS Code dependency, so the editor provider,
 * plain Node tests, and benchmarks all exercise the same code.
 */
export class LPCFormatter {
    /** Whether the text before a range start leaves it inside a string, comment, or continued directive. */
    public startsInsideProtectedContext(prefix: string): boolean {
        if (prefix.length === 0) {
            return false;
        }

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
            || preprocessor.continuationLines[lines.length - 1]
            || preprocessor.lineCommentContinuationLines[lines.length - 1];
    }

    public getInitialIndentLevel(code: string, options: LPCFormatOptions, indentSize: number): number {
        const lines = code.split(/\r?\n/);
        const preprocessor = this.analyzePreprocessorLines(lines);
        const firstContentLine = lines.find((line, index) => {
            const trimmed = line.trim();
            return trimmed.length > 0
                && !preprocessor.continuationLines[index]
                && !preprocessor.lineCommentContinuationLines[index]
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

    public format(
        code: string,
        options: LPCFormatOptions,
        indentSize: number,
        token?: FormatCancellation,
        initialIndentLevel = 0
    ): string {
        const indentString = options.insertSpaces
            ? ' '.repeat(indentSize)
            : '\t';
        
        const lines = this.preprocessLines(code.split(/\r?\n/));
        const unbracedIndentDepths = this.analyzeControlFlow(lines);
        
        let result: string[] = [];
        let indentLevel = initialIndentLevel;
        const switchStack: SwitchContext[] = [];
        let previousLineNeedsContinuation = false;
        let previousCurrentIndent = 0;
        let stringContinuationColumn = -1;
        let stringContinuationPrefix = '';
        let lpcStructureIndentStack: number[] = [];
        const lpcStructureStack: LPCStructureDelimiter[] = [];
        let inBlockComment = false;
        let blockCommentIndent = 0;
        let lpcDataStructureDepth = 0;
        const bracketStack: BracketInfo[] = [];
        let preprocessorIndentStack: number[] = [];
        const preprocessorFormatStack: PreprocessorFormatContext[] = [];
        let inBackslashStringContinuation = false;
        let inLineCommentContinuation = false;
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

            if (inLineCommentContinuation) {
                result.push(line);
                inLineCommentContinuation = this.endsWithLineContinuation(line);
                continue;
            }
            
            // Handle backslash string continuation - preserve original line as-is
            if (inBackslashStringContinuation) {
                result.push(line);
                const continuedString = this.scanContinuedStringLine(line);
                const continuationScanner = this.updateBracketStack(
                    continuedString.code,
                    previousCurrentIndent,
                    bracketStack
                );
                if (continuationScanner.inBlockComment) {
                    inBlockComment = true;
                    blockCommentIndent = previousCurrentIndent;
                }
                const structureCounts = this.countBracesAndStructures(
                    continuedString.code,
                    false,
                    lpcStructureStack
                );
                indentLevel = Math.max(
                    0,
                    indentLevel + structureCounts.openBraceCount - structureCounts.closeBraceCount
                );
                lpcDataStructureDepth = Math.max(
                    0,
                    lpcDataStructureDepth + structureCounts.openingCount - structureCounts.closingCount
                );
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
                    stringContinuationPrefix,
                    lpcDataStructureDepth,
                    bracketStack: bracketStack.map(bracket => ({ ...bracket })),
                    lpcStructureIndentStack: [...lpcStructureIndentStack],
                    lpcStructureStack: [...lpcStructureStack],
                    switchStack: switchStack.map(context => ({ ...context })),
                    pendingForHeader
                });
            } else if (preprocessorDirective === 'else' || preprocessorDirective === 'elif') {
                const branchState = preprocessorFormatStack[preprocessorFormatStack.length - 1];
                if (branchState) {
                    previousLineNeedsContinuation = branchState.previousLineNeedsContinuation;
                    previousCurrentIndent = branchState.previousCurrentIndent;
                    stringContinuationColumn = branchState.stringContinuationColumn;
                    stringContinuationPrefix = branchState.stringContinuationPrefix;
                    lpcDataStructureDepth = branchState.lpcDataStructureDepth;
                    bracketStack.splice(0, bracketStack.length, ...branchState.bracketStack.map(bracket => ({ ...bracket })));
                    lpcStructureIndentStack.splice(
                        0,
                        lpcStructureIndentStack.length,
                        ...branchState.lpcStructureIndentStack
                    );
                    lpcStructureStack.splice(
                        0,
                        lpcStructureStack.length,
                        ...branchState.lpcStructureStack
                    );
                    switchStack.splice(
                        0,
                        switchStack.length,
                        ...branchState.switchStack.map(context => ({ ...context }))
                    );
                    pendingForHeader = branchState.pendingForHeader;
                }
            }

            let structuralIndent = indentLevel + unbracedIndentDepths[i];
            let specialIndent = structuralIndent;
            if (lpcStructureIndentStack.length > 0) {
                specialIndent = lpcStructureIndentStack[lpcStructureIndentStack.length - 1];
            } else if (bracketStack.length > 0 && bracketStack[bracketStack.length - 1].char === '(') {
                specialIndent = bracketStack[bracketStack.length - 1].assignedIndent + 1;
            }
            
            const specialLineResult = this.handleSpecialLine(
                trimmed, 
                indentLevel,
                {
                    inBlockComment,
                    blockCommentIndent,
                    preprocessorIndentStack
                },
                indentString,
                specialIndent
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

                if (!inBlockComment && trimmed.startsWith('#') && !trimmed.startsWith("#'")
                    && this.endsWithLineContinuation(trimmed)) {
                    inPreprocessorContinuation = true;
                }
                if (!inBlockComment && trimmed.startsWith('//')
                    && this.hasContinuedLineComment(trimmed)) {
                    inLineCommentContinuation = true;
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
                } else {
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
            const previousLine = i > 0 ? lines[i - 1].trim() : '';
            let usesStringContinuationColumn = false;
            
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
                } else if (lpcStructureIndentStack.length > 0 && trimmed.startsWith('),')) {
                    currentIndent = lpcStructureIndentStack[lpcStructureIndentStack.length - 1];
                } else {
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
            else if (previousLineNeedsContinuation && stringContinuationColumn >= 0
                && trimmed.startsWith('"')) {
                usesStringContinuationColumn = true;
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
                const isNewMappingKey = trimmed.match(/^"[^"]+"\s*:\s*\(/);
                const previousWasMappingValue = previousLine.match(/\}\),\s*$/);

                stringContinuationColumn = -1;
                stringContinuationPrefix = '';
                if (isNewMappingKey && previousWasMappingValue) {
                    currentIndent = structuralIndent;
                } else {
                    currentIndent = Math.max(structuralIndent + 1, previousCurrentIndent);
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
                } else {
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
            
            if (usesStringContinuationColumn) {
                spaces = options.insertSpaces
                    ? ' '.repeat(stringContinuationColumn)
                    : stringContinuationPrefix || indentString.repeat(currentIndent);
                if (!trimmed.endsWith('+')) {
                    stringContinuationColumn = -1;
                    stringContinuationPrefix = '';
                }
            } else {
                stringContinuationColumn = -1;
                stringContinuationPrefix = '';
            }

            let codepart = trimmed;
            let commentPart = '';
            const lineCommentIndex = this.findFirstLineCommentOutsideStrings(trimmed);
            if (lineCommentIndex >= 0) {
                codepart = trimmed.substring(0, lineCommentIndex).trim();
                commentPart = ' ' + trimmed.substring(lineCommentIndex);
            }
            
            let normalizedTrimmed = this.normalizeSpacing(
                codepart,
                lpcStructureStack[lpcStructureStack.length - 1]
            );
            
            const previousHasTernary = this.stripCommentsAndStrings(previousLine).includes('?');
            const currentStartsWithColon = trimmed.startsWith(':');
            
            if (previousHasTernary && currentStartsWithColon && result.length > 0) {
                const prevFullLine = result[result.length - 1];
                const questionPos = prevFullLine.indexOf('?');
                if (questionPos >= 0) {
                    spaces = options.insertSpaces
                        ? ' '.repeat(questionPos)
                        : prevFullLine.match(/^[\t ]*/)?.[0] || indentString.repeat(currentIndent);
                }
            }
            
            const finalTrimmed = this.alignInlineComment(normalizedTrimmed, commentPart);

            const formattedLine = finalTrimmed ? spaces + finalTrimmed : '';
            const continuesLineComment = this.hasContinuedLineComment(trimmed, inBlockComment);
            if (/(?:^|[^+])\+\s*$/.test(structuralCode)) {
                const localStringStart = this.findLastStringLiteralStart(formattedLine);
                if (localStringStart >= 0) {
                    stringContinuationColumn = localStringStart;
                    stringContinuationPrefix = formattedLine.match(/^[\t ]*/)?.[0] ?? '';
                }
            }

            if (trimmed.startsWith(',') && result.length > 0) {
                result[result.length - 1] = result[result.length - 1] + ',';
                const withoutLeadingComma = trimmed.substring(1).trim();
                const fixedLine = spaces + withoutLeadingComma;
                result.push(fixedLine);
            } else {
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
            const lineScanner = this.updateBracketStack(
                formattedLine,
                currentIndent,
                bracketStack,
                pendingForHeader
            );
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

            const { openBraceCount, closeBraceCount, openingCount, closingCount} = 
                this.countBracesAndStructures(trimmed, leadingCloseBraceHandled, lpcStructureStack);
            const netLPCChange = openingCount - closingCount;
            
            const netBraces = openBraceCount - closeBraceCount;
            if (netBraces !== 0) {
                indentLevel = Math.max(0, indentLevel + netBraces);
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
            } else if (netLPCChange < 0) {
                for (let i = 0; i < Math.abs(netLPCChange); i++) {
                    if (lpcStructureIndentStack.length > 0) {
                        lpcStructureIndentStack.pop();
                    }
                }
            }
            inLineCommentContinuation = continuesLineComment;
        }

        result = this.postProcessMultiLinePatterns(result);
        if (options.compactSingleStatementFunctions !== false) {
            result = this.compactSingleStatementFunctions(result);
        }

        return result.join('\n');
    }

    private preprocessLines(lines: string[]): string[] {
        const canonicalLines = this.combineSplitLpcOpeners(lines);
        const preprocessedLines: string[] = [];
        let inBlockComment = false;
        let inBackslashStringContinuation = false;
        let inLineCommentContinuation = false;
        let inPreprocessorContinuation = false;
        
        for (const originalLine of canonicalLines) {
            if (inPreprocessorContinuation) {
                preprocessedLines.push(originalLine);
                inPreprocessorContinuation = this.endsWithLineContinuation(originalLine);
                continue;
            }

            if (inLineCommentContinuation) {
                preprocessedLines.push(originalLine);
                inLineCommentContinuation = this.endsWithLineContinuation(originalLine);
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

            if (trimmed.startsWith('//')) {
                preprocessedLines.push(line);
                inLineCommentContinuation = this.hasContinuedLineComment(line);
                continue;
            }

            if (trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                preprocessedLines.push(line);
                continue;
            }
            
            preprocessedLines.push(...this.splitInlineStatementBeforeCommentedBrace(line));

            inBackslashStringContinuation = this.endsWithBackslashInString(line);
            inLineCommentContinuation = this.hasContinuedLineComment(line, inBlockComment);
        }
        
        return preprocessedLines;
    }

    private splitInlineStatementBeforeCommentedBrace(line: string): string[] {
        const trimmed = line.trim();
        const commentPosition = this.findFirstCommentOutsideStrings(trimmed);
        if (commentPosition < 0) {
            return [line];
        }

        const codeOnly = trimmed.substring(0, commentPosition).trim();
        const oneLinerFunction = /^[a-zA-Z_][\w\s*]*\([^)]*\)\s*\{[^}]*\}\s*$/.test(codeOnly);
        const oneLinerControl = (
            /^(?:if|while|for|foreach)\s*\(/.test(codeOnly)
            || /^else\s*(?:if\s*\(|\{)/.test(codeOnly)
        ) && codeOnly.includes('{') && codeOnly.includes('}');
        const oneLinerIfElse = /^if\s*\([^)]*\)\s*\{[^}]*\}\s*else\s*\{[^}]*\}\s*$/.test(codeOnly);
        const inlineClosingBrace = codeOnly.match(/^(.*?;\s*)(\}+)\s*$/);

        if (!inlineClosingBrace || oneLinerFunction || oneLinerControl || oneLinerIfElse) {
            return [line];
        }

        const leadingSpaces = line.match(/^(\s*)/)?.[1] ?? '';
        const commentSuffix = trimmed.substring(commentPosition).trimStart();
        return [
            leadingSpaces + inlineClosingBrace[1].trim(),
            leadingSpaces + inlineClosingBrace[2] + (commentSuffix ? ' ' + commentSuffix : '')
        ];
    }

    private combineSplitLpcOpeners(lines: string[]): string[] {
        const combinedLines: string[] = [];
        const scanner = new CharacterScanner();
        const preprocessor = this.analyzePreprocessorLines(lines);
        let previousLineCanOpenLpcStructure = false;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const trimmedStart = line.trimStart();
            const opener = trimmedStart.charAt(0);
            const currentLineIsContinuation = preprocessor.continuationLines[lineIndex]
                || preprocessor.lineCommentContinuationLines[lineIndex];
            const previousLineIsContinuation = lineIndex > 0
                && (preprocessor.continuationLines[lineIndex - 1]
                    || preprocessor.lineCommentContinuationLines[lineIndex - 1]);
            const canCombine = previousLineCanOpenLpcStructure
                && !currentLineIsContinuation
                && !previousLineIsContinuation
                && (opener === '{' || opener === '[' || opener === '<')
                && !trimmedStart.startsWith('#')
                && !(opener === '<' && trimmedStart.startsWith('<='));

            if (canCombine && combinedLines.length > 0) {
                combinedLines[combinedLines.length - 1] =
                    combinedLines[combinedLines.length - 1].trimEnd() + trimmedStart;
            } else {
                combinedLines.push(line);
            }

            scanner.startLine();
            for (let index = 0; index < line.length; index++) {
                const { skipNext } = scanner.processChar(line, index);
                if (skipNext) {
                    index++;
                }
            }

            previousLineCanOpenLpcStructure = line.trimEnd().endsWith('(')
                && !scanner.inString
                && !scanner.inLineComment
                && !scanner.inBlockComment
                && !trimmedStart.startsWith('#');
        }

        return combinedLines;
    }

    private analyzeControlFlow(lines: string[], includePreprocessorBodies = true): number[] {
        const depths = new Array<number>(lines.length).fill(0);
        const tokens = this.tokenizeStructuralLines(lines);

        const markLines = (startLine: number, endLine: number, depth: number): void => {
            for (let line = startLine; line <= endLine && line < depths.length; line++) {
                depths[line] = Math.max(depths[line], depth);
            }
        };

        const findClosingParen = (openIndex: number): number => {
            if (tokens[openIndex]?.value !== '(') {
                return openIndex;
            }

            let depth = 0;
            for (let index = openIndex; index < tokens.length; index++) {
                if (tokens[index].value === '(') {
                    depth++;
                } else if (tokens[index].value === ')') {
                    depth--;
                    if (depth === 0) {
                        return index;
                    }
                }
            }
            return tokens.length - 1;
        };

        let parseStatement: (index: number, depth: number) => number;
        let parseSequence: (index: number, depth: number, stopAtClosingBrace?: boolean) => number;

        const parseBody = (headerEnd: number, depth: number): number => {
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

        const parseControl = (index: number, depth: number): number => {
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

        parseSequence = (index: number, depth: number, stopAtClosingBrace = false): number => {
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

        parseStatement = (index: number, depth: number): number => {
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
                    } else if (tokens[endIndex].value === ')') {
                        parenDepth--;
                    } else if (tokens[endIndex].value === ':' && parenDepth === 0) {
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
                } else if (current.value === ')') {
                    parenDepth = Math.max(0, parenDepth - 1);
                } else if (current.value === '{' && parenDepth === 0) {
                    markLines(token.line, current.line, depth);
                    return parseStatement(endIndex, depth);
                } else if (current.value === ';' && parenDepth === 0) {
                    markLines(token.line, current.line, depth);
                    return endIndex + 1;
                } else if (current.value === '}' && parenDepth === 0) {
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

    private applyPreprocessorControlDepths(lines: string[], depths: number[]): void {
        const preprocessor = this.analyzePreprocessorLines(lines);
        const continuationLines = preprocessor.continuationLines;
        const lineCommentContinuationLines = preprocessor.lineCommentContinuationLines;
        // The tokenizer only carries state forward, so the tokens of any line prefix
        // are a prefix of the whole file's tokens; tokenize once instead of per #if.
        const fileTokens = this.tokenizeStructuralLines(lines);

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            if (continuationLines[lineIndex] || lineCommentContinuationLines[lineIndex]) {
                continue;
            }
            const openingDirective = preprocessor.directives[lineIndex];
            if (openingDirective !== 'if' && openingDirective !== 'ifdef'
                && openingDirective !== 'ifndef') {
                continue;
            }

            const precedingTokenCount = this.countTokensBeforeLine(fileTokens, lineIndex);
            const headerEnd = fileTokens[precedingTokenCount - 1]?.line ?? -1;
            if (continuationLines[headerEnd] || lineCommentContinuationLines[headerEnd]) {
                continue;
            }
            const enclosingHeaderStart = this.findControlHeaderStartInTokens(fileTokens, precedingTokenCount - 1, headerEnd);
            const isControlBody = enclosingHeaderStart >= 0;

            const branches: Array<{ start: number; end: number }> = [];
            let branchStart = lineIndex + 1;
            let conditionalDepth = 0;
            let closingDirective = -1;

            for (let cursor = lineIndex; cursor < lines.length; cursor++) {
                const directive = preprocessor.directives[cursor];
                if (directive === 'if' || directive === 'ifdef' || directive === 'ifndef') {
                    conditionalDepth++;
                } else if (directive === 'endif') {
                    conditionalDepth--;
                    if (conditionalDepth === 0) {
                        branches.push({ start: branchStart, end: cursor });
                        closingDirective = cursor;
                        break;
                    }
                } else if ((directive === 'else' || directive === 'elif') && conditionalDepth === 1) {
                    branches.push({ start: branchStart, end: cursor });
                    branchStart = cursor + 1;
                }
            }

            if (closingDirective < 0) {
                continue;
            }

            const parentDepth = isControlBody ? depths[headerEnd] : depths[lineIndex];
            const pendingHeaders: Array<{ lines: string[]; depth: number }> = [];
            const analyzedBranches: string[][] = [];
            let allBranchesAnalyzable = true;
            for (const branch of branches) {
                const branchLines = lines.slice(branch.start, branch.end);
                const structuralBranchLines = branchLines.map((line, offset) =>
                    continuationLines[branch.start + offset]
                        || lineCommentContinuationLines[branch.start + offset]
                        ? ''
                        : line
                );
                const branchTokens = this.tokenizeStructuralLines(structuralBranchLines);
                if (branchTokens.length === 0) {
                    allBranchesAnalyzable = false;
                    continue;
                }
                const branchVariants = this.expandPreprocessorVariants(structuralBranchLines);
                if (branchVariants.length === 0) {
                    allBranchesAnalyzable = false;
                } else {
                    analyzedBranches.push(...branchVariants);
                }

                const bodyDepth = parentDepth
                    + (isControlBody && branchTokens[0].value !== '{' ? 1 : 0);
                const branchDepths = this.analyzeControlFlow(structuralBranchLines, false);
                for (let offset = 0; offset < branchLines.length; offset++) {
                    if (!continuationLines[branch.start + offset]
                        && !lineCommentContinuationLines[branch.start + offset]) {
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
                const pendingHeader = pendingHeaders.reduce((shallowest, current) =>
                    current.depth < shallowest.depth ? current : shallowest
                );
                const { statementEnd, depths: syntheticDepths } = this.analyzeLeadingStatement(
                    pendingHeader.lines,
                    lines,
                    closingDirective + 1
                );

                for (let syntheticLine = pendingHeader.lines.length;
                    syntheticLine <= statementEnd;
                    syntheticLine++) {
                    const sourceLine = closingDirective + 1
                        + syntheticLine - pendingHeader.lines.length;
                    if (sourceLine < lines.length) {
                        depths[sourceLine] = pendingHeader.depth + syntheticDepths[syntheticLine];
                    }
                }
            }

            const enclosingHeaderLines = enclosingHeaderStart >= 0
                ? lines.slice(enclosingHeaderStart, headerEnd + 1)
                : [];
            const enclosingTokens = this.tokenizeStructuralLines(enclosingHeaderLines);
            const hasEnclosingIf = enclosingTokens[0]?.value === 'if'
                || (enclosingTokens[0]?.value === 'else' && enclosingTokens[1]?.value === 'if');
            if (allBranchesAnalyzable && analyzedBranches.length > 0
                && hasEnclosingIf
                && this.firstTokenFromLine(lines, closingDirective + 1)?.value === 'else') {
                const tailStartLine = closingDirective + 1;
                let analyzedTailLength = 0;
                const tailDepthsByBranch = analyzedBranches.map(branchLines => {
                    const { statementEnd, depths: syntheticDepths } = this.analyzeLeadingStatement(
                        [...enclosingHeaderLines, ...branchLines],
                        lines,
                        tailStartLine
                    );
                    const tailStart = enclosingHeaderLines.length + branchLines.length;
                    const tailLength = Math.max(0, Math.min(lines.length - tailStartLine, statementEnd - tailStart + 1));
                    analyzedTailLength = Math.max(analyzedTailLength, tailLength);
                    return Array.from({ length: tailLength }, (_line, offset) => syntheticDepths[tailStart + offset]);
                });

                for (let offset = 0; offset < analyzedTailLength; offset++) {
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

    private analyzePreprocessorLines(lines: string[]): PreprocessorLineInfo {
        const continuationLines = new Array<boolean>(lines.length).fill(false);
        const lineCommentContinuationLines = new Array<boolean>(lines.length).fill(false);
        const directives = new Array<PreprocessorDirective | undefined>(lines.length).fill(undefined);
        let inDirectiveContinuation = false;
        let inLineCommentContinuation = false;
        let inBlockComment = false;
        let inContinuedString = false;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            continuationLines[lineIndex] = inDirectiveContinuation;
            lineCommentContinuationLines[lineIndex] = inLineCommentContinuation;
            if (inDirectiveContinuation) {
                inDirectiveContinuation = this.endsWithLineContinuation(line);
                continue;
            }

            if (inLineCommentContinuation) {
                inLineCommentContinuation = this.endsWithLineContinuation(line);
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
                const directive = trimmed.match(
                    /^#\s*(if|ifdef|ifndef|elif|else|endif)\b/
                )?.[1] as PreprocessorDirective | undefined;
                directives[lineIndex] = directive;
                inDirectiveContinuation = this.endsWithLineContinuation(line);
                continue;
            }

            const commentPosition = this.findFirstCommentOutsideStrings(line);
            if (commentPosition >= 0 && line.substring(commentPosition, commentPosition + 2) === '/*'
                && line.indexOf('*/', commentPosition + 2) < 0) {
                inBlockComment = true;
            }
            inLineCommentContinuation = this.hasContinuedLineComment(line, inBlockComment);
            inContinuedString = this.endsWithBackslashInString(line);
        }

        return { continuationLines, lineCommentContinuationLines, directives };
    }

    private expandPreprocessorVariants(lines: string[], maxVariants = 32): string[][] {
        const preprocessor = this.analyzePreprocessorLines(lines);
        const isOpeningDirective = (directive: PreprocessorDirective | undefined): boolean =>
            directive === 'if' || directive === 'ifdef' || directive === 'ifndef';
        const sanitizeRange = (start: number, end: number): string[] =>
            lines.slice(start, end).map((line, offset) =>
                preprocessor.continuationLines[start + offset]
                    || preprocessor.lineCommentContinuationLines[start + offset]
                    ? ''
                    : line
            );

        const expandRange = (start: number, end: number): string[][] => {
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

            const branches: Array<{ start: number; end: number }> = [];
            let branchStart = opening + 1;
            let depth = 0;
            let closing = -1;
            let hasElseBranch = false;
            for (let lineIndex = opening; lineIndex < end; lineIndex++) {
                const directive = preprocessor.directives[lineIndex];
                if (isOpeningDirective(directive)) {
                    depth++;
                } else if (directive === 'endif') {
                    depth--;
                    if (depth === 0) {
                        branches.push({ start: branchStart, end: lineIndex });
                        closing = lineIndex;
                        break;
                    }
                } else if ((directive === 'elif' || directive === 'else') && depth === 1) {
                    branches.push({ start: branchStart, end: lineIndex });
                    branchStart = lineIndex + 1;
                    hasElseBranch ||= directive === 'else';
                }
            }

            if (closing < 0) {
                return [sanitizeRange(start, end)];
            }

            const branchVariants: Array<{ start: number; lines: string[] }> = [];
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
            const variants: string[][] = [];
            for (const branch of branchVariants) {
                for (const suffix of suffixVariants) {
                    const variant = new Array<string>(end - start).fill('');
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

    private tokenizeStructuralLines(lines: string[]): StructuralToken[] {
        const tokens: StructuralToken[] = [];
        let inBlockComment = false;
        let inLineCommentContinuation = false;
        let inContinuedString = false;
        let inPreprocessorContinuation = false;

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const trimmed = line.trimStart();

            if (inPreprocessorContinuation) {
                inPreprocessorContinuation = this.endsWithLineContinuation(line);
                continue;
            }

            if (inLineCommentContinuation) {
                inLineCommentContinuation = this.endsWithLineContinuation(line);
                continue;
            }

            if (!inBlockComment && !inContinuedString
                && trimmed.startsWith('#') && !trimmed.startsWith("#'")) {
                inPreprocessorContinuation = this.endsWithLineContinuation(line);
                continue;
            }

            let inString: boolean = inContinuedString;
            let stringDelimiter: '"' | "'" | null = inContinuedString ? '"' : null;
            let escaped = false;
            let lineCommentPosition = -1;

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
                    } else if (char === '\\') {
                        escaped = true;
                    } else if (char === stringDelimiter) {
                        inString = false;
                        stringDelimiter = null;
                    }
                    continue;
                }

                if (char === '/' && nextChar === '/') {
                    lineCommentPosition = index;
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
            inLineCommentContinuation = lineCommentPosition >= 0
                && this.endsWithLineContinuation(line);
        }

        return tokens;
    }

    private handleSpecialLine(
        trimmed: string,
        indentLevel: number,
        state: {
            inBlockComment: boolean;
            blockCommentIndent: number;
            preprocessorIndentStack: number[];
        },
        indentString: string = '    ',
        contentIndentLevel = indentLevel
    ): SpecialLineResult {
        if (!state.inBlockComment && trimmed.startsWith('#') && !trimmed.startsWith("#'")) {
            let newIndentLevel: number | undefined;
            const directive = trimmed.match(
                /^#\s*(if|ifdef|ifndef|elif|else|endif)\b/
            )?.[1] as PreprocessorDirective | undefined;

            if (directive === 'if' || directive === 'ifdef' || directive === 'ifndef') {
                state.preprocessorIndentStack.push(indentLevel);
            } else if (directive === 'else' || directive === 'elif') {
                if (state.preprocessorIndentStack.length > 0) {
                    newIndentLevel = state.preprocessorIndentStack[state.preprocessorIndentStack.length - 1];
                }
            } else if (directive === 'endif' && state.preprocessorIndentStack.length > 0) {
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
                } else {
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
            } else if (trimmed.startsWith('*/')) {
                formattedComment = ' */';
            } else if (trimmed.length > 0) {
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

    private normalizeSpacing(code: string, enclosingStructure?: LPCStructureDelimiter): string {
        let normalized = this.replaceOutsideProtectedText(code, /,\s{2,}/g, ', ');

        normalized = this.replaceOutsideProtectedText(
            normalized,
            /\b([A-Za-z_]\w*)\s+\(/g,
            (_match, identifier) => /^(?:if|for|foreach|while|switch|return)$/.test(identifier)
                ? `${identifier} (`
                : `${identifier}(`
        );
        normalized = this.replaceOutsideProtectedText(
            normalized,
            /\b(if|for|foreach|while|switch)\s*\(/g,
            '$1 ('
        );
        normalized = this.replaceOutsideProtectedText(normalized, /\s*->\s*/g, '->');
        normalized = this.replaceOutsideProtectedText(
            normalized,
            /([A-Za-z0-9_)\]}])\s*\.\s*([A-Za-z_(])/g,
            '$1.$2'
        );
        normalized = this.replaceOutsideProtectedText(normalized, /\(\s+(?!\(\{)/g, '(');
        normalized = this.replaceOutsideProtectedText(
            normalized,
            new RegExp(`\\((${LPC_DECLARATION_TYPE_PATTERN})(\\s*\\*)?\\)\\s+([A-Za-z_(])`, 'g'),
            '($1$2)$3'
        );
        
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
        
        normalized = this.replaceOutsideProtectedText(
            normalized,
            new RegExp(`${NOT_FLOAT_EXPONENT_SIGN}([a-zA-Z0-9_")\\]}])\\+([a-zA-Z0-9_"({])`, 'g'),
            '$1 + $2'
        );
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_")\]}]) \+([a-zA-Z0-9_"({])/g, '$1 + $2');
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_")\]}])\+ ([a-zA-Z0-9_"({])/g, '$1 + $2');
        normalized = this.replaceOutsideProtectedText(
            normalized,
            new RegExp(`${NOT_FLOAT_EXPONENT_SIGN}([a-zA-Z0-9_")\\]}])-([a-zA-Z0-9_"({])`, 'g'),
            '$1 - $2'
        );
        normalized = this.normalizeMultiplicationSpacing(normalized);
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_)\]}])\/([a-zA-Z0-9_({])/g, '$1 / $2');
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_)\]}])%([a-zA-Z0-9_({])/g, '$1 % $2');
        
        normalized = this.replaceOutsideProtectedText(normalized, /,([a-zA-Z0-9_"'({])/g, ', $1');
        
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_")\]}])\+=([a-zA-Z0-9_"({])/g, '$1 += $2');
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_")\]}]) \+=([a-zA-Z0-9_"({])/g, '$1 += $2');
        normalized = this.replaceOutsideProtectedText(normalized, /([a-zA-Z0-9_")\]}])\+= ([a-zA-Z0-9_"({])/g, '$1 += $2');

        normalized = this.replaceOutsideProtectedText(
            normalized,
            /([a-zA-Z0-9_")\]}])\s*(>>>=|&&=|\|\|=)\s*([a-zA-Z0-9_"'({])/g,
            '$1 $2 $3'
        );
        normalized = this.replaceOutsideProtectedText(
            normalized,
            /([a-zA-Z0-9_")\]}])\s*>>>\s*([a-zA-Z0-9_"'({])/g,
            '$1 >>> $2'
        );
        
        normalized = this.replaceOutsideProtectedText(normalized, /\(:\s+/g, '(: ');
        normalized = this.replaceOutsideProtectedText(normalized, /\s+:\)/g, ' :)');
        normalized = this.replaceOutsideProtectedText(normalized, /\(:\s+(.+?)\s+:\)/g, (_match, content) => {
            const contentNormalized = content.replace(/\s{2,}/g, ' ');
            return `(: ${contentNormalized} :)`;
        });

        return this.normalizeOperatorSpacing(normalized, enclosingStructure);
    }

    /**
     * Applies C-style operator spacing from a token stream, so context decides
     * spacing: unary vs. binary operators, ternary vs. mapping/case/foreach
     * colons, union types, type groups, reverse indexes, and struct literals.
     * Only whitespace between tokens changes; strings, comments, and closure
     * references are opaque, and `*` keeps the pointer-aware handling above.
     */
    private normalizeOperatorSpacing(code: string, enclosingStructure?: LPCStructureDelimiter): string {
        const tokens = this.tokenizeForSpacing(code);
        if (tokens.length < 2) {
            return code;
        }

        const rootKind: SpacingFrame['kind'] = enclosingStructure === ']'
            ? 'mapping'
            : enclosingStructure === '>' ? 'struct' : enclosingStructure === '}' ? 'array' : 'root';
        const frames: SpacingFrame[] = [this.createSpacingFrame(rootKind)];
        // separators[i] is the whitespace to place before tokens[i]; undefined keeps the original.
        const separators: Array<string | undefined> = new Array(tokens.length).fill(undefined);
        const operandEnds = new Array<boolean>(tokens.length).fill(false);
        const spaceAround = (index: number): void => {
            if (index > 0) {
                separators[index] = ' ';
            }
            if (index + 1 < tokens.length) {
                separators[index + 1] = ' ';
            }
        };
        const previousIndex = (index: number): number => {
            let cursor = index - 1;
            while (cursor >= 0 && tokens[cursor].kind === 'comment') {
                cursor--;
            }
            return cursor;
        };

        for (let index = 0; index < tokens.length; index++) {
            const token = tokens[index];
            const frame = frames[frames.length - 1];
            const previous = previousIndex(index);
            const previousToken = previous >= 0 ? tokens[previous] : undefined;
            const nextToken = tokens[index + 1];
            const afterOperand = previous >= 0 && operandEnds[previous];

            if (token.kind === 'word') {
                if (token.text === 'case' || token.text === 'default') {
                    frame.pendingCase = true;
                }
                operandEnds[index] = !KEYWORDS_BEFORE_OPERAND.has(token.text) && !LPC_TYPE_WORDS.has(token.text);
                continue;
            }
            if (token.kind !== 'punct') {
                operandEnds[index] = token.kind !== 'comment';
                continue;
            }

            switch (token.text) {
                case '(': {
                    const paren = this.createSpacingFrame('paren');
                    paren.foreachHeader = previousToken?.text === 'foreach';
                    frames.push(paren);
                    break;
                }
                case '[':
                    frames.push(this.createSpacingFrame('index'));
                    break;
                case '{':
                    frames.push(this.createSpacingFrame('brace'));
                    break;
                case '({':
                    frames.push(this.createSpacingFrame('array'));
                    break;
                case '([':
                    frames.push(this.createSpacingFrame('mapping'));
                    break;
                case '(<':
                    frames.push(this.createSpacingFrame('multiset'));
                    break;
                case '(:':
                    frames.push(this.createSpacingFrame('closure'));
                    break;
                case ')':
                case ':)':
                    if (frames.length > 1) {
                        frames.pop();
                    }
                    operandEnds[index] = true;
                    break;
                case ']':
                    if (frame.kind === 'index' && frames.length > 1) {
                        frames.pop();
                    }
                    operandEnds[index] = true;
                    break;
                case '}':
                    if (frame.kind === 'brace' && frames.length > 1) {
                        frames.pop();
                    }
                    operandEnds[index] = true;
                    break;
                case ',':
                    separators[index] = '';
                    if (nextToken) {
                        separators[index + 1] = ' ';
                    }
                    break;
                case ';':
                    separators[index] = '';
                    if (nextToken && nextToken.text !== ';' && nextToken.text !== ')' && nextToken.text !== '}') {
                        separators[index + 1] = ' ';
                    }
                    break;
                case '?':
                    frame.pendingTernaries++;
                    spaceAround(index);
                    break;
                case ':':
                    if (frame.pendingTernaries > 0) {
                        frame.pendingTernaries--;
                        spaceAround(index);
                    } else if (frame.pendingCase || frame.kind === 'mapping' || frame.kind === 'struct') {
                        frame.pendingCase = false;
                        separators[index] = '';
                        if (nextToken) {
                            separators[index + 1] = ' ';
                        }
                    } else if (frame.kind === 'paren' && frame.foreachHeader) {
                        spaceAround(index);
                    }
                    break;
                case '<': {
                    const opensTypeGroup = nextToken !== undefined
                        && (LPC_TYPE_WORDS.has(nextToken.text) || nextToken.text === '<');
                    if (!opensTypeGroup && afterOperand) {
                        spaceAround(index);
                    }
                    break;
                }
                case '>': {
                    const closesStructName = frame.kind === 'multiset' && previous >= 1
                        && previousToken?.kind === 'word' && tokens[previousIndex(previous)]?.text === '(<';
                    if (closesStructName) {
                        frame.kind = 'struct';
                        operandEnds[index] = false;
                    } else if ((frame.kind === 'multiset' || frame.kind === 'struct') && nextToken?.text === ')') {
                        operandEnds[index] = true;
                    } else if (previousToken && (LPC_TYPE_WORDS.has(previousToken.text) || previousToken.text === '*')) {
                        operandEnds[index] = true;
                    } else if (afterOperand) {
                        spaceAround(index);
                    }
                    break;
                }
                case '|': {
                    const typeBefore = previousToken !== undefined
                        && (LPC_TYPE_WORDS.has(previousToken.text) || previousToken.text === '*' || previousToken.text === '>');
                    const typeAfter = nextToken !== undefined
                        && (LPC_TYPE_WORDS.has(nextToken.text) || nextToken.text === '<');
                    if (typeBefore && typeAfter) {
                        separators[index] = '';
                        separators[index + 1] = '';
                    } else {
                        spaceAround(index);
                    }
                    break;
                }
                case '-':
                case '+':
                case '&':
                    if (previous < 0) {
                        // A leading operator on a continuation line may be binary; keep it as written.
                        break;
                    }
                    if (afterOperand) {
                        spaceAround(index);
                    } else if (nextToken) {
                        separators[index + 1] = '';
                    }
                    break;
                case '*': {
                    // Types, `struct Name`, and closed type groups make `*` a pointer declarator.
                    const declaresPointer = previousToken?.text === '>'
                        || (previousToken?.kind === 'word' && tokens[previousIndex(previous)]?.text === 'struct');
                    if (afterOperand && !declaresPointer) {
                        spaceAround(index);
                    }
                    break;
                }
                case '!':
                case '~':
                    if (nextToken) {
                        separators[index + 1] = '';
                    }
                    break;
                case '++':
                case '--':
                    operandEnds[index] = afterOperand;
                    break;
                default:
                    if (SPACED_BINARY_OPERATORS.has(token.text)) {
                        spaceAround(index);
                    }
            }
        }

        let result = tokens[0].space + tokens[0].text;
        for (let index = 1; index < tokens.length; index++) {
            let separator = separators[index] ?? tokens[index].space;
            if (separator === '' && tokens[index].space !== ''
                && this.tokensMergeWhenJoined(tokens[index - 1], tokens[index])) {
                separator = tokens[index].space;
            }
            result += separator + tokens[index].text;
        }
        return result;
    }

    private createSpacingFrame(kind: SpacingFrame['kind']): SpacingFrame {
        return { kind, pendingTernaries: 0, pendingCase: false, foreachHeader: false };
    }

    /** Whether removing the whitespace between two tokens would change how they tokenize. */
    private tokensMergeWhenJoined(left: SpacingToken, right: SpacingToken): boolean {
        const joined = this.tokenizeForSpacing(left.text + right.text);
        return joined.length !== 2 || joined[0].text !== left.text || joined[1].text !== right.text;
    }

    private tokenizeForSpacing(code: string): SpacingToken[] {
        const mask = this.computeProtectedMask(code);
        const tokens: SpacingToken[] = [];
        let space = '';
        let index = 0;
        const push = (text: string, kind: SpacingToken['kind']): void => {
            tokens.push({ text, kind, space });
            space = '';
            index += text.length;
        };

        while (index < code.length) {
            if (mask[index]) {
                let end = index;
                while (end < code.length && mask[end]) {
                    end++;
                }
                const text = code.slice(index, end);
                push(text, text.startsWith('/') ? 'comment' : 'operand');
                continue;
            }

            const char = code[index];
            if (char === ' ' || char === '\t') {
                space += char;
                index++;
                continue;
            }

            const rest = code.slice(index);
            const closureReference = CLOSURE_REFERENCE.exec(rest);
            if (closureReference) {
                push(closureReference[0], 'operand');
                continue;
            }
            const symbol = /^'+[A-Za-z_]\w*/.exec(rest) ?? /^\$\d+/.exec(rest);
            if (symbol) {
                push(symbol[0], 'operand');
                continue;
            }
            if (!rest.startsWith('..')) {
                const number = NUMBER_LITERAL.exec(rest);
                if (number) {
                    push(number[0], 'number');
                    continue;
                }
            }
            const word = /^[A-Za-z_]\w*/.exec(rest);
            if (word) {
                push(word[0], 'word');
                continue;
            }

            const punctuator = SPACING_PUNCTUATORS.find(candidate => rest.startsWith(candidate));
            push(punctuator ?? char, 'punct');
        }

        return tokens;
    }

    private normalizeMultiplicationSpacing(code: string): string {
        const pattern = /([A-Za-z0-9_)\]}])\s*\*(\s*)([A-Za-z0-9_"'({])/g;
        const protectedMask = this.computeProtectedMask(code);
        let normalized = '';
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(code)) !== null) {
            normalized += code.substring(lastIndex, match.index);

            const starIndex = match.index + match[0].indexOf('*');
            const isProtected = this.rangeTouchesProtectedText(
                protectedMask,
                match.index,
                match[0].length
            );
            const isPointerDeclaration = this.isPointerDeclarationPrefix(
                code.substring(0, starIndex)
            );

            normalized += isProtected || isPointerDeclaration
                ? match[0]
                : `${match[1]} * ${match[3]}`;
            lastIndex = match.index + match[0].length;
        }

        return normalized + code.substring(lastIndex);
    }

    private isPointerDeclarationPrefix(prefix: string): boolean {
        const declarationTypePattern = new RegExp(
            `^(?:(?:${LPC_MODIFIER_PATTERN})\\s+)*(?:${LPC_DECLARATION_TYPE_PATTERN}|<[^;{}]+>)$`
        );
        const structuralPrefix = this.stripCommentsAndStrings(prefix);
        // Parameter lists and foreach headers start a declaration after '(' or ','.
        const lastStatementBoundary = Math.max(
            structuralPrefix.lastIndexOf('{'),
            structuralPrefix.lastIndexOf('}'),
            structuralPrefix.lastIndexOf(';'),
            structuralPrefix.lastIndexOf('('),
            structuralPrefix.lastIndexOf(',')
        );
        return declarationTypePattern.test(structuralPrefix.substring(lastStatementBoundary + 1).trim());
    }

    /**
     * Analyzes the first statement of `prefixLines` followed by `lines` from `tailStart`,
     * reading only as many tail lines as that statement needs. The window grows until
     * the statement ends before the last token in it, which makes the result identical
     * to analyzing the whole tail while keeping each #if region's cost local.
     */
    private analyzeLeadingStatement(
        prefixLines: string[],
        lines: string[],
        tailStart: number
    ): { statementEnd: number; depths: number[] } {
        const tailLength = Math.max(0, lines.length - tailStart);
        for (let windowSize = 64; ; windowSize *= 4) {
            const windowLength = Math.min(windowSize, tailLength);
            const syntheticLines = [...prefixLines, ...lines.slice(tailStart, tailStart + windowLength)];
            const { line, complete } = this.locateFirstStatementEnd(syntheticLines);
            if (complete || windowLength === tailLength) {
                return { statementEnd: line, depths: this.analyzeControlFlow(syntheticLines, false) };
            }
        }
    }

    private firstTokenFromLine(lines: string[], startLine: number): StructuralToken | undefined {
        for (let windowSize = 16; ; windowSize *= 4) {
            const window = lines.slice(startLine, startLine + windowSize);
            const tokens = this.tokenizeStructuralLines(window);
            if (tokens.length > 0 || startLine + windowSize >= lines.length) {
                return tokens[0];
            }
        }
    }

    private countTokensBeforeLine(tokens: StructuralToken[], line: number): number {
        let low = 0;
        let high = tokens.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (tokens[middle].line < line) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        return low;
    }

    /** `complete` is false when the statement may continue past the last token of `lines`. */
    private locateFirstStatementEnd(lines: string[]): { line: number; complete: boolean } {
        const tokens = this.tokenizeStructuralLines(lines);
        if (tokens.length === 0) {
            return { line: -1, complete: false };
        }

        const findClosingParen = (openIndex: number): number => {
            let depth = 0;
            for (let index = openIndex; index < tokens.length; index++) {
                if (tokens[index].value === '(') {
                    depth++;
                } else if (tokens[index].value === ')' && --depth === 0) {
                    return index;
                }
            }
            return tokens.length - 1;
        };

        const skipBlock = (openIndex: number): number => {
            let depth = 0;
            for (let index = openIndex; index < tokens.length; index++) {
                if (tokens[index].value === '{') {
                    depth++;
                } else if (tokens[index].value === '}' && --depth === 0) {
                    return index + 1;
                }
            }
            return tokens.length;
        };

        let skipStatement: (index: number) => number;
        const skipBody = (headerEnd: number): number => {
            return headerEnd + 1 < tokens.length
                ? skipStatement(headerEnd + 1)
                : headerEnd + 1;
        };

        skipStatement = (index: number): number => {
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
                } else if (tokens[cursor].value === ')') {
                    parenDepth = Math.max(0, parenDepth - 1);
                } else if (tokens[cursor].value === '{' && parenDepth === 0) {
                    return skipBlock(cursor);
                } else if (tokens[cursor].value === ';' && parenDepth === 0) {
                    return cursor + 1;
                } else if (tokens[cursor].value === '}' && parenDepth === 0) {
                    return cursor;
                }
            }
            return tokens.length;
        };

        const nextIndex = skipStatement(0);
        return {
            line: tokens[Math.max(0, Math.min(tokens.length - 1, nextIndex - 1))].line,
            complete: nextIndex < tokens.length
        };
    }

    private findControlHeaderStart(lines: string[], endLine: number): number {
        if (endLine < 0) {
            return -1;
        }

        const tokens = this.tokenizeStructuralLines(lines.slice(0, endLine + 1));
        return this.findControlHeaderStartInTokens(tokens, tokens.length - 1, endLine);
    }

    private findControlHeaderStartInTokens(
        tokens: StructuralToken[],
        lastTokenIndex: number,
        endLine: number
    ): number {
        if (endLine < 0 || lastTokenIndex < 0) {
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
            } else if (value === '(' && --balance === 0) {
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

    private updateBracketStack(
        line: string,
        currentIndent: number,
        bracketStack: BracketInfo[],
        preserveFirstParen = false
    ): CharacterScanner {
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

            if (char === '(' && (nextChar === '{' || nextChar === '[' || nextChar === '<')
                && !this.isStructLiteralStart(line, column)) {
                bracketStack.push({ char: '(', assignedIndent: currentIndent });
                column++;
                continue;
            }

            if ((char === '}' || char === ']' || char === '>') && nextChar === ')') {
                const matchingBracket = char === '}'
                    ? '{'
                    : char === ']'
                        ? '['
                        : '<';
                if (bracketStack[bracketStack.length - 1]?.char === matchingBracket) {
                    bracketStack.pop();
                }
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
            } else if (char === ')' || char === ']' || char === '}') {
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

    private countBracesAndStructures(
        trimmed: string,
        leadingCloseBraceHandled: boolean,
        lpcStructureStack: LPCStructureDelimiter[]
    ): {
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
            if (char === '(' && (nextChar === '{' || nextChar === '[' || nextChar === '<')
                && !this.isStructLiteralStart(trimmed, i)) {
                openingCount++;
                lpcStructureStack.push(nextChar === '{' ? '}' : nextChar === '[' ? ']' : '>');
                i++;  // Skip the {/[/<
                continue;
            }

            // LPC structure closers: }), ]), >)
            if ((char === '}' || char === ']' || char === '>') && nextChar === ')') {
                if (lpcStructureStack[lpcStructureStack.length - 1] === char) {
                    closingCount++;
                    lpcStructureStack.pop();
                    i++;  // Skip the )
                    continue;
                }
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

    private isStructLiteralStart(line: string, index: number): boolean {
        if (line[index] !== '(' || line[index + 1] !== '<') {
            return false;
        }

        const typeMatch = line.substring(index + 2).match(
            /^\s*(?:struct\s+)?[A-Za-z_]\w*\s*>/
        );
        if (!typeMatch) {
            return false;
        }

        return line.substring(index + 2 + typeMatch[0].length).trimStart().charAt(0) !== ')';
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

    private findLastStringLiteralStart(line: string): number {
        const scanner = new CharacterScanner();
        let lastStart = -1;

        for (let index = 0; index < line.length; index++) {
            const startsString = line[index] === '"' && !scanner.inString
                && !scanner.inLineComment && !scanner.inBlockComment;
            const { skipNext } = scanner.processChar(line, index);
            if (startsString) {
                lastStart = index;
            }
            if (skipNext) {
                index++;
            }
        }

        return lastStart;
    }

    private findFirstCommentOutsideStrings(line: string): number {
        return this.findFirstComment(line, false);
    }

    private findFirstLineCommentOutsideStrings(line: string): number {
        return this.findFirstComment(line, true);
    }

    private hasContinuedLineComment(line: string, inBlockComment = false): boolean {
        const scanner = new CharacterScanner();
        scanner.inBlockComment = inBlockComment;

        for (let index = 0; index < line.length; index++) {
            const char = line[index];
            const nextChar = index + 1 < line.length ? line[index + 1] : '';
            if (!scanner.inString && !scanner.inLineComment && !scanner.inBlockComment
                && char === '/' && nextChar === '/') {
                return this.endsWithLineContinuation(line);
            }

            const { skipNext } = scanner.processChar(line, index);
            if (skipNext) {
                index++;
            }
        }

        return false;
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

    private endsWithLineContinuation(line: string): boolean {
        const trimmed = line.trimEnd();
        let backslashCount = 0;
        for (let index = trimmed.length - 1; index >= 0 && trimmed[index] === '\\'; index--) {
            backslashCount++;
        }
        return backslashCount % 2 === 1;
    }

    private scanContinuedStringLine(line: string): { code: string; continues: boolean } {
        let code = '';
        let inString = true;
        let escaped = false;

        for (let index = 0; index < line.length; index++) {
            const char = line[index];
            if (inString) {
                code += ' ';
                if (escaped) {
                    escaped = false;
                } else if (char === '\\') {
                    escaped = true;
                } else if (char === '"') {
                    inString = false;
                }
            } else if (char === '"') {
                code += ' ';
                inString = true;
                escaped = false;
            } else {
                code += char;
            }
        }

        return {
            code,
            continues: inString && this.endsWithLineContinuation(line)
        };
    }

    private hasUnclosedBlockComment(line: string): boolean {
        const scanner = new CharacterScanner();
        for (let index = 0; index < line.length; index++) {
            const { skipNext } = scanner.processChar(line, index);
            if (skipNext) {
                index++;
            }
        }
        return scanner.inBlockComment;
    }

    private isCharacterLiteralAt(line: string, index: number): boolean {
        if (line[index + 1] === '\\') {
            return index + 3 < line.length && line[index + 3] === "'";
        }
        return index + 2 < line.length && line[index + 2] === "'";
    }

    private computeProtectedMask(
        line: string,
        scanner: CharacterScanner = new CharacterScanner()
    ): boolean[] {
        const mask = new Array<boolean>(line.length).fill(false);
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
        let lambdaParenDepth = 0;
        let inLineCommentContinuation = false;
        let inPreprocessorContinuation = false;
        const analysisScanner = new CharacterScanner();
        const isClosureContent = (content: string): boolean => {
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
            if (inLineCommentContinuation) {
                inLineCommentContinuation = this.endsWithLineContinuation(line);
                processed.push(line);
                if (!inLineCommentContinuation) {
                    analysisScanner.startLine();
                }
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
                if (this.hasContinuedLineComment(line, lineStartScanner.inBlockComment)) {
                    inLineCommentContinuation = true;
                }
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
            if (this.hasContinuedLineComment(line, lineStartScanner.inBlockComment)) {
                inLineCommentContinuation = true;
            }
        }
        
        return processed;
    }

    private compactSingleStatementFunctions(lines: string[]): string[] {
        const compacted: string[] = [];

        for (let index = 0; index < lines.length; index++) {
            const header = lines[index];
            const headerText = header.trim();
            const openingBraceMatch = headerText.match(/^(.*)\{\s*$/);
            const hasSeparateOpeningBrace = lines[index + 1]?.trim() === '{';
            const functionHeader = openingBraceMatch?.[1].trimEnd() ?? headerText;
            const bodyIndex = openingBraceMatch ? index + 1 : index + 2;
            const closingBraceIndex = bodyIndex + 1;
            const body = lines[bodyIndex]?.trim() ?? '';
            const canCompact = (openingBraceMatch !== null || hasSeparateOpeningBrace)
                && closingBraceIndex < lines.length
                && LPC_FUNCTION_DECLARATION_PATTERN.test(this.stripCommentsAndStrings(functionHeader).trim())
                && this.findFirstCommentOutsideStrings(headerText) < 0
                && body.length > 0
                && this.findFirstCommentOutsideStrings(body) < 0
                && lines[closingBraceIndex].trim() === '}'
                && this.stripCommentsAndStrings(body).trimEnd().endsWith(';');

            if (canCompact) {
                const structureStack: LPCStructureDelimiter[] = [];
                const structureCounts = this.countBracesAndStructures(body, false, structureStack);
                if (structureCounts.openBraceCount === 0
                    && structureCounts.closeBraceCount === 0
                    && structureStack.length === 0) {
                    const indentation = header.match(/^[\t ]*/)?.[0] ?? '';
                    compacted.push(`${indentation}${functionHeader} { ${body} }`);
                    index = closingBraceIndex;
                    continue;
                }
            }

            compacted.push(header);
        }

        return compacted;
    }

    private countParenthesisDelta(line: string): number {
        let delta = 0;
        for (const char of line) {
            if (char === '(') {
                delta++;
            } else if (char === ')') {
                delta--;
            }
        }
        return delta;
    }

    private needsContinuation(line: string): boolean {
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

        if (/(?:->|>>>|&&|\|\||==|!=|<=|>=|<<|>>|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|[=+\-*/%&|^<>?:])\s*$/.test(trimmedLine)
            && !trimmedLine.match(/^\s*(case\s+|default\s*:)/)) {
            return true;
        }
        
        if (trimmedLine.endsWith(',')) {
            return true;
        }
        
        return false;
    }

    private startsWithContinuationOperator(line: string): boolean {
        return /^(?:>>>|<<|>>|&&|\|\||->|==|!=|<=|>=|\+(?!\+)|\/(?![/*])|[%&|^?]|:(?!:))/.test(line);
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
        return this.stripCommentsAndStringsWithScanner(line, new CharacterScanner());
    }

    private stripCommentsAndStringsWithScanner(line: string, scanner: CharacterScanner): string {
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
