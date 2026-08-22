# Copilot instructions

## Project scope

This is a VS Code language extension for LPC as implemented by LDMUD and used by the LP-245 mudlib. It provides TextMate syntax highlighting, editor language configuration, and a stateful document/range formatter. Treat `.c` and `.h` files as LPC in this repository, not as C/C++.

## Build, lint, and validation

Use Node.js 20.19 or newer.

```powershell
npm install          # Install development dependencies
npm run compile      # Compile src/**/*.ts to the tracked out/ runtime files
npm run watch        # Compile continuously
npm run lint         # ESLint src/**/*.ts
npm test             # Compile, lint, and run Extension Host integration tests
npm test -- "name"   # Run tests whose names contain the given text
npm run package      # Build the VSIX with vsce
```

Press F5 in VS Code to compile and run the extension in an Extension Development Host. The launch configuration loads `out/**/*.js` and invokes the `npm: compile` pre-launch task. Runtime JavaScript, declarations, and source maps under `out/` are tracked; include regenerated changes when modifying `src/`.

`npm test` uses `@vscode/test-electron`; its first run downloads a cached VS Code build into `.vscode-test/`. Tests cover formatter behavior, range formatting, grammar/configuration patterns, and fixture idempotence. For a manual fixture check, format `formatted-lpc-test.lpc` twice and verify that it has no diff:

```powershell
git --no-pager diff --exit-code -- formatted-lpc-test.lpc
```

The second formatting pass must also be a no-op; formatter idempotence is a core requirement. `expected-result.lpc` is the golden reference, but it uses CRLF while `formatted-lpc-test.lpc` uses LF.

## Architecture

- `package.json` is the integration hub: it activates on the `lpc` language, maps `.lpc`, `.c`, and `.h`, contributes the TextMate grammar and formatter settings, and declares the `lpc.format` command.
- `src/extension.ts` creates one `LPCDocumentFormattingEditProvider` for both whole-document and range formatting. The command delegates to VS Code's standard `editor.action.formatDocument`.
- `src/formatProvider.ts` contains the formatter. Its pipeline preprocesses compound lines, handles comments/preprocessor/blank lines, computes indentation from persistent state, separates inline comments, normalizes only unprotected code, updates bracket and LPC-structure stacks, then applies multiline post-processing. Range formatting expands selections to complete lines and seeds the formatter from their existing indentation; whole-document formatting alone applies the configured final newline.
- `src/test/runTest.ts` launches the Extension Development Host; `src/test/suite/index.ts` contains the dependency-free integration test registry and substring filtering.
- `syntaxes/lpc.tmGrammar.json` controls tokenization and highlighting only. `language-configuration.json` separately controls comments, bracket pairs, auto-closing, indentation, and folding. Neither drives the formatter.
- `out/extension.js` is the packaged entry point. `.vscodeignore` excludes TypeScript sources, test output, source maps, fixtures, and assistant instructions from the VSIX.

## Repository-specific conventions

- Preserve text inside strings, character literals, and comments while treating quoted symbols such as `'name` as code. Reuse `CharacterScanner`, `replaceOutsideProtectedText()`, `stripCommentsAndStrings()`, and the comment-finding helpers rather than applying regex replacements to an entire raw line.
- Treat LPC structures `({ ... })`, `([ ... ])`, and `(< ... >)` separately from ordinary braces/brackets. Keep all three opener/closer forms synchronized in bracket-stack, indentation, and continuation logic. `#'[` is an operator function reference, not an opening bracket.
- State-update order in `formatLPCCode()` is significant. Indentation is chosen from the current stacks before the formatted line updates brace, LPC-structure, continuation, switch/case, and comment state. Empty lines and completed statements deliberately reset stack state.
- Preserve LDMUD formatting behavior: switch `case` labels use `-cli0` alignment, function braces use K&R style, one-line functions/control statements stay intact, and backslash-continued strings remain byte-for-byte unchanged. Four spaces is the default, but the provider must honor VS Code's `insertSpaces`, `tabSize`, and `lpc.formatting.indentSize`.
- Keep formatting idempotent: one pass must converge, especially for nested closures, mappings, multisets, lambdas, continuation lines, and closing sequences such as `}));`.
- Grammar rule order prevents overlapping regexes. Keep operators ordered from specific to general (arrow, compound assignment, shifts, comparison, logical, bitwise, arithmetic, bare assignment, ternary), and keep float matching before decimal matching. Recursive LPC structures and lambdas use `$self`.
- A single quote starts LPC character, symbol, or function-reference syntax. Do not add single-quote auto-closing; it intentionally appears only as a surrounding pair.
- LPC type and modifier lists are centralized as formatter regex constants but remain duplicated in the TextMate grammar. When adding one, update both `syntaxes/lpc.tmGrammar.json` and `src/formatProvider.ts`, including cast, declaration, and closure post-processing patterns.
- Formatter settings must stay synchronized between `package.json` contributions and the reads in both formatting-provider entry points.
