# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VS Code extension providing language support for **LPC (Lars Pensjö C)** targeting the **LDMUD game driver** and **LP-245 mudlib**. Provides syntax highlighting (TextMate grammar) and a production-grade code formatter.

## Build & Development Commands

Use Node.js 24.11 or newer.

```bash
npm run compile       # Compile TypeScript to out/
npm run watch         # Compile in watch mode
npm run lint          # Strict tsc checks for src/ and scripts/ (no ESLint)
npm run test          # Run tests (compiles + lints first via pretest)
npm test -- "name"    # Run tests whose names contain the given text
npm run package       # Build the .vsix with scripts/package-vsix.mjs (no vsce)
```

Keep external dependencies to the minimum: the only devDependencies are `typescript`, `@types/node`, and `@types/vscode`. Packaging (`scripts/package-vsix.mjs`) and the VS Code test host (`src/test/vscodeTestHost.ts`) are in-repo, dependency-free replacements for `@vscode/vsce` and `@vscode/test-electron`. Do not add npm packages for tooling that Node's standard library can cover.

**Debug:** Press F5 in VS Code to compile and launch an Extension Development Host.

## Architecture

The extension has a small runtime plus an Extension Host test harness:

- **`src/extension.ts`** — Entry point. Registers the formatting provider for document and range formatting, plus the `lpc.format` command. Activates on `onLanguage:lpc`.

- **`src/formatProvider.ts`** (~2,600 lines) — The core of the extension. Implements `LPCDocumentFormattingEditProvider` with two public methods (`provideDocumentFormattingEdits`, `provideDocumentRangeFormattingEdits`) that delegate to the private `formatLPCCode()` state machine.

- **`src/test/runTest.ts` / `src/test/vscodeTestHost.ts` / `src/test/suite/index.ts`** — Resolve a VS Code build from the official update service, verify its SHA-256, extract it into `.vscode-test/`, and run dependency-free integration tests. Test names can be filtered with the argument passed to `npm test --`; `VSCODE_TEST_VERSION=1.74.0` pins a specific VS Code version.

- **`scripts/package-vsix.mjs`** — Builds the VSIX from an explicit allowlist derived from `package.json` (main, compiled `out/**/*.js` except tests, language configuration, grammars, README, CHANGELOG, LICENSE) and generates the same manifest as vsce. Output is reproducible.

- **`syntaxes/lpc.tmGrammar.json`** — TextMate grammar for syntax highlighting. Covers LDMUD-specific efuns, applies, closures, lambdas, data types, and preprocessor directives.

### Formatter State Machine (`formatLPCCode`)

The formatter processes lines sequentially, maintaining state across:
- **Indent tracking** — `indentLevel`, bracket stack with indent assignments
- **Brace-less control flow** — A lightweight structural pass assigns nesting depth before line formatting
- **Switch/case** — Uses a context stack so nested switches retain LDMUD `-cli0` style (case at the same level as its switch)
- **LPC data structures** — Depth tracking for `({...})` arrays, `([...])` mappings, `(<...>)` multisets
- **Protected text** — `CharacterScanner` distinguishes strings, character literals, comments, and quoted LPC symbols so protected content is never modified
- **Block comments** — Preserves formatting within `/* */` blocks
- **Continuation lines** — Detects unclosed brackets, leading/trailing operators, casts, and commas without losing state across trivia
- **Range formatting** — Expands selections to complete lines and seeds indentation from the first selected content line

Key helper methods: `preprocessLines()` (splits compound statements), `analyzeControlFlow()` (computes brace-less nesting), `normalizeSpacing()` (operator spacing), `countBracesAndStructures()` (bracket stack management), `replaceOutsideProtectedText()` (safe regex replacement), `stripCommentsAndStrings()` (analysis-safe line content), and `findFirstCommentOutsideStrings()` (string-aware comment detection).

### TextMate Grammar (`lpc.tmGrammar.json`)

Operator rules are ordered by precedence to avoid regex overlap: arrow → compound assignment → bitwise shift → comparison → logical → bitwise non-shift → arithmetic → bare assignment → ternary. Numeric rules are ordered: hex → binary → octal → float → decimal (float before decimal so `1.5` is not split into `1` + `.5`).

### Extension Settings

Defined in `package.json` under `contributes.configuration`:
- `lpc.formatting.enabled` (boolean, default: true)
- `lpc.formatting.indentSize` (number, default: 4)
- `lpc.formatting.insertFinalNewline` (boolean, default: true)

## Testing Approach

`npm test` launches an isolated Extension Development Host and covers formatter edge cases, range indentation, language configuration, and grammar patterns. Formatter regressions are auto-discovered from sanitized input/expected pairs in `src/test/fixtures/formatter/`; every pair must match exactly and converge after one formatting pass. The first run downloads a cached VS Code test build into `.vscode-test/`.

Files under `out/` are generated and ignored by Git. `npm run compile` creates them for development, and `npm run package` rebuilds them before packaging. Test output under `out/test/` is excluded from the VSIX.

## LPC Language Specifics

LPC extends C with constructs that the formatter must handle carefully:
- **Closure syntax:** `(: ... :)` and `#'function`
- **Array literals:** `({ item1, item2 })`
- **Mapping literals:** `([ key: value ])`
- **Multiset literals:** `(< item1, item2 >)`
- **Lambda expressions:** `lambda(...)` with nested function references
- **Scope resolution:** `::function_name()` for inherited calls
- **Backslash string continuation:** Multi-line strings using `\` at line end
