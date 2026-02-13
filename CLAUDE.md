# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VS Code extension providing language support for **LPC (Lars Pensjö C)** targeting the **LDMUD game driver** and **LP-245 mudlib**. Provides syntax highlighting (TextMate grammar) and a production-grade code formatter.

## Build & Development Commands

```bash
npm run compile       # Compile TypeScript to out/
npm run watch         # Compile in watch mode
npm run lint          # ESLint on src/**/*.ts
npm run test          # Run tests (compiles + lints first via pretest)
npm run package       # Build .vsix extension package with vsce
```

**Debug:** Press F5 in VS Code to launch an Extension Development Host with the extension loaded.

## Architecture

The extension has two source files and a grammar definition:

- **`src/extension.ts`** — Entry point. Registers the formatting provider for document and range formatting, plus the `lpc.format` command. Activates on `onLanguage:lpc`.

- **`src/formatProvider.ts`** (~1,300 lines) — The core of the extension. Implements `LPCDocumentFormattingEditProvider` with two public methods (`provideDocumentFormattingEdits`, `provideDocumentRangeFormattingEdits`) that delegate to the private `formatLPCCode()` state machine.

- **`syntaxes/lpc.tmGrammar.json`** — TextMate grammar for syntax highlighting. Covers LDMUD-specific efuns, applies, closures, lambdas, data types, and preprocessor directives.

### Formatter State Machine (`formatLPCCode`)

The formatter processes lines sequentially, maintaining state across:
- **Indent tracking** — `indentLevel`, bracket stack with indent assignments
- **Switch/case** — Tracks switch context for LDMUD `-cli0` style (case at same level as switch)
- **LPC data structures** — Depth tracking for `({...})` arrays, `([...])` mappings, `(<...>)` multisets
- **String safety** — `isInsideString()`, `endsWithBackslashInString()` ensure string content is never modified
- **Block comments** — Preserves formatting within `/* */` blocks
- **Continuation lines** — Detects unclosed brackets, trailing operators/commas

Key helper methods: `preprocessLines()` (splits compound statements), `normalizeSpacing()` (operator spacing), `countBracesAndStructures()` (bracket stack management), `replaceOutsideStrings()` (safe regex replacement), `stripCommentsAndStrings()` (analysis-safe line content), `findFirstCommentOutsideStrings()` (string-aware comment detection).

### TextMate Grammar (`lpc.tmGrammar.json`)

Operator rules are ordered by precedence to avoid regex overlap: arrow → compound assignment → bitwise shift → comparison → logical → bitwise non-shift → arithmetic → bare assignment → ternary. Numeric rules are ordered: hex → binary → octal → float → decimal (float before decimal so `1.5` is not split into `1` + `.5`).

### Extension Settings

Defined in `package.json` under `contributes.configuration`:
- `lpc.formatting.enabled` (boolean, default: true)
- `lpc.formatting.indentSize` (number, default: 4)
- `lpc.formatting.insertFinalNewline` (boolean, default: true)

## Testing Approach

The formatter is validated using zero-diff testing against real-world LDMUD/LP-245 mudlib code. The file `formatted-lpc-test.lpc` contains representative test cases. When modifying the formatter, run it against this file and verify the output matches expectations — any unintended diff indicates a regression.

## LPC Language Specifics

LPC extends C with constructs that the formatter must handle carefully:
- **Closure syntax:** `(: ... :)` and `#'function`
- **Array literals:** `({ item1, item2 })`
- **Mapping literals:** `([ key: value ])`
- **Multiset literals:** `(< item1, item2 >)`
- **Lambda expressions:** `lambda(...)` with nested function references
- **Scope resolution:** `::function_name()` for inherited calls
- **Backslash string continuation:** Multi-line strings using `\` at line end
