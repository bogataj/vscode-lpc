# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VS Code extension providing language support for **LPC (Lars Pensjö C)** targeting the **LDMUD game driver** and **LP-245 mudlib**. Provides syntax highlighting (TextMate grammar) and a production-grade code formatter.

## Build & Development Commands

Use Node.js 20.19 or newer.

```bash
npm run compile       # Compile TypeScript to out/
npm run watch         # Compile in watch mode
npm run lint          # ESLint on src/**/*.ts
npm run test          # Run tests (compiles + lints first via pretest)
npm test -- "name"    # Run tests whose names contain the given text
npm run package       # Build .vsix extension package with vsce
```

**Debug:** Press F5 in VS Code to compile and launch an Extension Development Host.

## Architecture

The extension has a small runtime plus an Extension Host test harness:

- **`src/extension.ts`** — Entry point. Registers the formatting provider for document and range formatting, plus the `lpc.format` command. Activates on `onLanguage:lpc`.

- **`src/formatProvider.ts`** (~1,300 lines) — The core of the extension. Implements `LPCDocumentFormattingEditProvider` with two public methods (`provideDocumentFormattingEdits`, `provideDocumentRangeFormattingEdits`) that delegate to the private `formatLPCCode()` state machine.

- **`src/test/runTest.ts` / `src/test/suite/index.ts`** — Launch VS Code through `@vscode/test-electron` and run dependency-free integration tests. Test names can be filtered with the argument passed to `npm test --`.

- **`syntaxes/lpc.tmGrammar.json`** — TextMate grammar for syntax highlighting. Covers LDMUD-specific efuns, applies, closures, lambdas, data types, and preprocessor directives.

### Formatter State Machine (`formatLPCCode`)

The formatter processes lines sequentially, maintaining state across:
- **Indent tracking** — `indentLevel`, bracket stack with indent assignments
- **Switch/case** — Uses a context stack so nested switches retain LDMUD `-cli0` style (case at the same level as its switch)
- **LPC data structures** — Depth tracking for `({...})` arrays, `([...])` mappings, `(<...>)` multisets
- **Protected text** — `CharacterScanner` distinguishes strings, character literals, comments, and quoted LPC symbols so protected content is never modified
- **Block comments** — Preserves formatting within `/* */` blocks
- **Continuation lines** — Detects unclosed brackets, trailing operators/commas
- **Range formatting** — Expands selections to complete lines and seeds indentation from the first selected content line

Key helper methods: `preprocessLines()` (splits compound statements), `normalizeSpacing()` (operator spacing), `countBracesAndStructures()` (bracket stack management), `replaceOutsideProtectedText()` (safe regex replacement), `stripCommentsAndStrings()` (analysis-safe line content), and `findFirstCommentOutsideStrings()` (string-aware comment detection).

### TextMate Grammar (`lpc.tmGrammar.json`)

Operator rules are ordered by precedence to avoid regex overlap: arrow → compound assignment → bitwise shift → comparison → logical → bitwise non-shift → arithmetic → bare assignment → ternary. Numeric rules are ordered: hex → binary → octal → float → decimal (float before decimal so `1.5` is not split into `1` + `.5`).

### Extension Settings

Defined in `package.json` under `contributes.configuration`:
- `lpc.formatting.enabled` (boolean, default: true)
- `lpc.formatting.indentSize` (number, default: 4)
- `lpc.formatting.insertFinalNewline` (boolean, default: true)

## Testing Approach

`npm test` launches an isolated Extension Development Host and covers formatter edge cases, range indentation, language configuration, grammar patterns, and zero-diff/idempotence checks against `formatted-lpc-test.lpc`. The first run downloads a cached VS Code test build into `.vscode-test/`.

After changing TypeScript, commit the regenerated tracked files under `out/`. Test output under `out/test/` is excluded from the VSIX.

## LPC Language Specifics

LPC extends C with constructs that the formatter must handle carefully:
- **Closure syntax:** `(: ... :)` and `#'function`
- **Array literals:** `({ item1, item2 })`
- **Mapping literals:** `([ key: value ])`
- **Multiset literals:** `(< item1, item2 >)`
- **Lambda expressions:** `lambda(...)` with nested function references
- **Scope resolution:** `::function_name()` for inherited calls
- **Backslash string continuation:** Multi-line strings using `\` at line end
