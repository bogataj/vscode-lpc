# Change Log

All notable changes to the "LPC Language Support" extension will be documented in this file.

## [1.3.0] - 2026-02-13

### Fixed
- **Cascading Indentation**: Fixed formatter producing different results on repeated runs
  - Indentation of LPC data structures (`({`, `([`, `(<`) no longer shifts by one level on each format
  - Root cause: indent computation referenced original input lines instead of formatter state
  - Formatter now converges in a single pass regardless of input formatting

- **Bracket Stack Leaking Across Functions**: Fixed state leaking between function bodies
  - Empty lines now properly reset bracket stack and LPC structure indent stack
  - Prevents indentation of one function being affected by the previous function's closures

- **LPC Structure Closer Handling**: Fixed `])` and `>)` not popping the bracket stack
  - Previously only `})` was handled, causing bracket stack entries from mappings and multisets to accumulate
  - All three LPC structure closers now correctly tracked

- **`#'[` Function Reference**: Fixed `#'[` (LPC function reference to indexing operator) being counted as unclosed bracket
  - `({#'[, 'a, WL_EXTRA})` no longer causes false continuation detection
  - Both `hasUnclosedBrackets` and bracket stack tracking now skip `#'[` pattern

- **Continuation vs Closing Bracket Conflict**: Fixed continuation indent overriding closing bracket indent
  - Lines starting with `})`, `])`, `>)`, or `)` are no longer treated as continuation content

### Improved
- **Formatter Refactoring**: Major internal cleanup of the formatter engine
  - Extracted `CharacterScanner` utility class to eliminate duplicated string/comment tracking logic across 7+ methods
  - Merged two near-identical character-scanning loops in `countBracesAndStructures` into a single pass
  - Defined `BracketInfo` and `SpecialLineResult` interfaces to replace inline type definitions
  - Removed dead code: `lastLineWasPreprocessor`, `previousLineWasFunctionCall`, unused `insideLPCStructure` parameter

- **Performance**: Fixed O(n²) behavior in `replaceOutsideStrings`
  - Added `computeStringMask` to pre-compute string context in a single O(n) pass
  - Regex match position checks now use O(1) array lookup instead of rescanning from position 0
  - Early return when no regex matches are found

- **Configuration**: Added `lpc.formatting.enabled` and `lpc.formatting.insertFinalNewline` settings
  - Formatting can now be toggled on/off via `lpc.formatting.enabled`
  - `indentSize` is passed as a parameter from callers that already read the config
  - Cancellation token support for responsive formatting of large files

- **Lint Clean**: Resolved all 26 ESLint errors and warnings
  - Fixed unnecessary escape characters in regex patterns (`\)`, `\}`, `\>`, `\&`, `\-`)
  - Fixed ESLint config to properly handle TypeScript (`no-unused-vars` and `no-undef` deferred to TypeScript)
  - Replaced `any` type with `string[]` in replacement callback signature
  - Configured `argsIgnorePattern` for underscore-prefixed unused parameters

- **Syntax Highlighting**: Improved TextMate grammar
  - Operator rules reordered by precedence to prevent regex overlap
  - Float rule ordered before decimal to correctly tokenize `1.5`
  - Added `deprecated` to storage modifiers
  - Removed `function` from keyword operators (conflicts with function declarations)
  - Removed `unknown` from primitive types (not a valid LDMUD type)
  - Bare assignment `=` uses negative lookahead `=(?!=)` to avoid matching `==`
  - Removed single-quote auto-closing pair (conflicts with LPC symbol syntax `'symbol`)

- **Packaging**: Added `.claude/` and `CLAUDE.md` to `.vscodeignore`

## [1.2.11] - 2025-12-02

### Fixed
- **Formatter Respects User Indent Settings**: Formatter now correctly uses configured tab/space settings
  - Uses `options.insertSpaces` and `options.tabSize` from VS Code formatting options
  - Previously hardcoded to 4 spaces, now respects user's editor configuration
  - Consistent indentation throughout formatted code

- **Function Argument Continuation Indent**: Improved multi-line function call formatting
  - Function arguments now use continuation indent (base indent + 1) following K&R standard
  - Changed from cascading indent to stable indent based on opening parenthesis
  - Aligns with LDMUD test code formatting conventions

- **Closure Array Comma Detection**: Fixed continuation detection for closure arrays
  - Commas outside balanced structures (e.g., `({...}),`) now properly trigger continuation
  - Smart detection distinguishes between commas inside vs outside local structures
  - Prevents false positives from unclosed brackets

- **LPC Data Structure Depth Tracking**: Fixed state update ordering
  - `lpcDataStructureDepth` now updated before continuation detection
  - Ensures accurate context for comma continuation decisions
  - Prevents incorrect indentation in nested closures

### Improved
- **Syntax Highlighting Enhancements**: Better recognition of LPC language features
  - Added scope resolution operator `::` for inherited calls
  - Added character literal support `'x'` with escape sequences
  - Improved lambda/closure pattern matching with negative lookahead for `:)`
  - Better numeric constant categorization (hex, binary, octal, decimal, float)
  - Fixed ternary operator `:` to avoid conflicts with lambda syntax
  - Nested patterns in lambdas now use `$self` for recursive matching

## [1.2.10] - 2025-11-29

### Fixed
- **String Content Modification**: Fixed formatter incorrectly adding spaces around operators inside strings
  - Strings like `"=chairs"` were being changed to `" = chairs"`
  - Modified `replaceOutsideStrings()` to check if ANY character in the match is inside a string
  - Now properly preserves all content within string literals

## [1.2.9] - 2025-11-22

### Fixed
- **Control Statements with Trailing Comments**: Fixed incorrect indentation when control statements have trailing comments
  - Control statements like `if (...)  // comment` are now properly recognized
  - Single-statement bodies after control statements with comments are correctly indented
  - Modified `isControlStatementWithoutBrace()` to strip comments before checking line structure

## [1.2.8] - 2025-11-22

### Fixed
- **Escaped Characters in Strings**: Fixed incorrect indentation caused by brackets/parentheses inside strings
  - Properly handles escaped quotes by counting preceding backslashes (e.g., `" \\([12]h\\)"`)
  - String content no longer affects bracket matching or indentation logic
  - Fixed escape detection in multiple locations:
    - Bracket stack tracking during formatting
    - `hasUnclosedBrackets()` function
    - `countBracesAndStructures()` function
    - `stripCommentsAndStrings()` function
    - Comment splitting logic
  - LPC structure counting (`({`, `})`, etc.) now properly ignores content in strings and comments
  - Even number of backslashes = quote is NOT escaped
  - Odd number of backslashes = quote IS escaped

## [1.2.7] - 2025-10-19

### Fixed
- **Backslash String Continuation**: Fixed incorrect indentation of multi-line strings using backslash continuation
  - Lines continuing with `\` at end of line are now preserved as-is
  - String literals like `"text\` followed by continuation lines maintain original formatting
  - Added `endsWithBackslashInString()` method to detect backslash continuations
  - Prevents formatter from adding unwanted indentation to string content

## [1.2.6] - 2025-10-19

### Fixed
- **Closing Brace/Paren Corruption**: Fixed formatter removing closing braces and parentheses
  - `min(({ 100, evasion2 }));` no longer becomes `min(({ 100, evasion2 });` (missing closing brace)
  - `lambda(...}) ) ) )` no longer becomes `lambda(...}) ) )` (missing closing paren)
  - Added regex protection for `}));` and `}) ) )` patterns in nested structures
  
- **Space Removal in Closure Syntax**: Fixed incorrect space removal in `( ({` patterns
  - `( ({ ...` patterns now preserved correctly
  - Added negative lookahead in regex: `/\(\s+(?!\(\{)/g` to protect LPC closure syntax
  
- **Multi-line Control Statement Indentation**: Fixed incorrect indentation of multi-line if/while/for statement bodies
  - Control statement conditions spanning multiple lines now properly detected
  - Statement body after multi-line condition correctly indented
  - Fixed `isControlStatementWithoutBrace()` to check for unclosed brackets
  
- **Inline Comments with Braces**: Fixed over-indentation when inline comments contain braces
  - Lines like `if (x) { // comment with {` no longer cause extra indentation
  - Added `stripCommentsAndStrings()` helper for accurate brace counting
  - Comments now properly stripped before checking if line ends with `{`

### Improved
- **Code Organization**: Refactored formatProvider.ts for better maintainability
  - Extracted `preprocessLines()` method (52 lines) - splits statements with closing braces
  - Extracted `normalizeSpacing()` method (77 lines) - all spacing normalization rules
  - Extracted `handleSpecialLine()` method (136 lines) - comments, empty lines, preprocessor
  - Extracted `alignInlineComment()` method (33 lines) - aligns comments to column multiples
  - Extracted `countBracesAndStructures()` method (106 lines) - counts braces excluding strings/comments
  - Reduced main `formatLPCCode()` method from 810 to ~500 lines (38% reduction)
  - Removed 135 lines of redundant comments
  - Total file reduced from 1198 to 1095 lines while improving organization

## [1.2.5] - 2025-10-19

### Improved
- **Column-Aligned Inline Comments**: Enhanced inline comment alignment for better readability
  - Lines ending with `{` get 1 space before comment
  - Other lines align comments to multiples of 4 columns (minimum 2 spaces)
  - Creates clean, consistent visual columns for related statements
  - Tab-stop alignment integrates naturally with 4-space indentation

## [1.2.4] - 2025-10-19

### Fixed
- **Binary Operator Spacing in One-liners**: Fixed missing spaces around operators in one-liner statements
  - Added proper spacing for `+`, `-`, `*`, `/`, `%` operators (e.g., `arg+"_aptness"` → `arg + "_aptness"`)
  - Added proper spacing for compound assignment operators like `+=`, `-=`, `*=`, `/=`, etc.
  - Multiple normalization passes handle partially-spaced operators

- **String Content Protection**: Fixed operators being incorrectly modified inside string literals
  - Paths like `"/std/object"` no longer get spaces added (was becoming `" / std/object"`)
  - Format specifiers like `"%s"` preserved correctly in strings
  - Context-aware operator patterns exclude quotes where appropriate

- **Comment Content Protection**: Fixed operator spacing being applied inside comments
  - Comment content now separated before normalization is applied
  - Prevents comments like `// Post-increment` from becoming `// Post - increment`
  - String-aware comment detection avoids false positives from quotes in strings

- **One-liner else-if Preservation**: Fixed `else if` statements being incorrectly split
  - Pattern detection now handles `else if(...)` syntax properly
  - Closing braces on `else if` one-liners stay on same line

- **Consistent Inline Comment Spacing**: Standardized spacing before inline comments
  - Lines ending with `{` get 1 space before comment
  - All other inline comments get 4 spaces for consistency
  - Removed complex alignment logic in favor of simple, predictable spacing

## [1.2.3] - 2025-10-19

### Fixed
- **Brace Indentation with Comments**: Fixed incorrect indentation when opening brace has inline comment
  - Opening braces followed by comments (e.g., `{ // comment`) now correctly detected
  - Changed exact match check to prefix check for brace detection
  - Prevents extra indentation level being added after if statements with commented braces

- **One-liner Statement Preservation**: Fixed one-liner if/while/for/foreach statements being incorrectly split
  - One-liner control statements now preserved intact (e.g., `if(x) { return y; }`)
  - Improved pattern detection to handle complex nested function calls in conditions
  - Simplified detection logic to check for keyword and brace presence instead of parsing parentheses

## [1.2.2] - 2025-10-18

### Fixed
- **Critical: Comment Content Now Ignored During Formatting**: Fixed formatter counting brackets/braces inside comments
  - Comments (`//` and `/* */`) are now completely ignored when counting brackets for indentation
  - Prevents indentation corruption when comments contain code-like syntax
  - Added comprehensive comment skip logic in both bracket-counting loops
  - Added preprocessor comment filtering for `; }` pattern detection
  - Test cases added to verify comments don't leak formatting logic

- **Function Name Highlighting**: Fixed function declarations not being syntax-highlighted
  - Function names in declarations now properly colored (e.g., `void test_function()`)
  - Moved function pattern matching earlier in grammar processing order
  - Simplified regex pattern for better reliability

## [1.2.1] - 2025-10-18

### Added
- **Macro/Constant Highlighting**: Enhanced syntax highlighting for preprocessor macros and constants
  - All-uppercase identifiers (3+ characters) now highlighted as constants (e.g., `BUFFER_SIZE`, `WL_NAME`)
  - Double-underscore macros highlighted (e.g., `__DEBUG__`, `__MASTER__`)
  - Macro names in `#define` statements now properly highlighted
  - Makes it easy to distinguish constants/macros from regular variables

### Fixed
- **Closing Parenthesis Alignment**: Fixed indentation for closing parentheses in deeply nested lambda/closure structures
  - Closing `)` now correctly aligns with the line containing the matching opening `(`
  - Fixed bracket stack matching to search for parentheses specifically, not just any bracket type
  - Added special handling for `#'[` operator syntax to prevent bracket stack interference
  - Resolves issues with functions like `write_file(implode(map(lambda(...))))` having misaligned closing brackets

## [1.2.0] - 2025-10-18

### Added
- **Comprehensive Whitespace Normalization**: Advanced spacing rules for consistent code formatting
  - Remove extra spaces before semicolons, closing parentheses, and opening braces
  - Normalize spaces after opening parentheses
  - Standardize spacing in type declarations
  - Clean up compound operators (==, !=, <=, >=, +=, -=, etc.)
  - Proper spacing around assignment operators
  - Function reference operator `#'` spacing normalization
  - String concatenation spacing
  - Inline closure `(: ... :)` spacing
  - **Case statement normalization**: Single space after `case`, no space before `:`
- **Enhanced Syntax Highlighting**: Function pointers now properly highlighted
  - Function references like `#'function_name` now colored as function entities
  - Operator function references like `#'=`, `#'+`, etc. also highlighted
  - Improved pattern matching order for better syntax recognition

### Fixed
- **Critical String Protection**: String literal contents are now completely protected from modification
  - Character-by-character state tracking with escape sequence handling
  - Regex replacements only applied to code outside of strings
  - Tested with complex multi-space patterns inside strings
- Spaces removed after opening parentheses following LDMUD conventions
- Multiple spaces in case labels normalized (e.g., `case  1:` → `case 1:`)
- Space before colon in case statements removed (e.g., `case 2 :` → `case 2:`)
- Spacing between `})` and `)` in nested closures/arrays

### Improved
- Zero-diff formatting achieved on 1029-line comprehensive test file
- More robust code/string boundary detection
- Better handling of LDMUD closure syntax `({'symbol})`, `({#'func})`, `({ values })`
- Enhanced formatting consistency across all LPC language constructs

## [1.1.0] - 2025-10-18

### Added
- **K&R Function Brace Style**: Function opening braces now appear on the same line as the declaration (industry standard)
- **Always-Braces Mode**: Enhanced safety with braces required for all single-statement bodies
- **Industry-Standard Block Comments**: Aligned asterisk formatting for multi-line comments
  - Automatic ` * ` formatting for continuation lines
  - Smart detection of inline vs. multi-line comments
  - Proper spacing for opening `/*` and closing `*/`
- **Comma Spacing Normalization**: Multiple spaces after commas automatically collapsed to single space

### Fixed
- Switch case label indentation now properly maintained across multiple case statements
- Block comment state tracking no longer interferes with code indentation
- Inline comments `/* ... */` on same line no longer trigger block comment mode
- LPC structure brackets `({`, `})`, `([`, `])`, `(<`, `>)` correctly excluded from bracket stack
- Function body indentation after K&R brace merging
- Switch state persistence through nested control structures

### Improved
- More robust switch statement handling with proper state tracking
- Better alignment for closing parentheses and brackets
- Enhanced continuation line detection for complex expressions
- Improved formatting consistency across 929 lines of test code

## [1.0.0] - 2025-01-XX

### Added
- Initial release of LPC Language Support for LDMUD
- Comprehensive syntax highlighting for LPC language constructs
- Advanced code formatter with LDMUD conventions support:
  - LDMUD `-cli0` case label indentation (case at switch body level)
  - LDMUD `-i4` 4-space indentation
  - LDMUD `-br` brace-right style
  - Proper handling of LPC data structures: arrays `({})`, mappings `([])`, multisets `(<>)`
  - Smart indentation for nested function calls and lambda expressions
  - Continuation line handling for multi-line statements
- Language configuration for brackets, auto-closing pairs, and comments
- Support for `.lpc`, `.c`, and `.h` file extensions
- LDMUD-specific keywords, efuns, and applies highlighting
- Function pointer syntax highlighting `#'function_name`
- Lambda expression support `(: $1 + $2 :)`

### Features
- Document formatting (Format Document)
- Range formatting (Format Selection)
- Manual format command (`lpc.format`)
- Configurable indentation settings
- Full bracket pair matching for LPC structures

### Formatter Highlights
- Correctly formats switch statements according to LDMUD `-cli0` convention
- Handles complex nested LPC data structures with stack-based tracking
- Supports continuation indentation for multi-line function calls
- Properly aligns closing parentheses with their opening context
- Maintains consistent indentation for lambda bodies and closures
- Special handling for mapping elements and nested structures

## [Unreleased]

### Planned
- Code snippets for common LPC patterns
- Hover documentation for LDMUD efuns
- Auto-completion for LDMUD functions
- Signature help for function parameters
