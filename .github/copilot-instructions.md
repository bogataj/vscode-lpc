# Copilot instructions

## Project scope

This is a VS Code language extension for LPC as implemented by LDMUD and used by the LP-245 mudlib. It provides TextMate syntax highlighting, editor language configuration, and a stateful document/range formatter. Treat `.c` and `.h` files as LPC in this repository, not as C/C++.

## Build, lint, and validation

Use Node.js 24.11 or newer.

```powershell
npm install          # Install development dependencies
npm run compile      # Clean and compile src/**/*.ts to generated out/ files
npm run watch        # Compile continuously
npm run lint         # Strict tsc checks for src/ and scripts/
npm test             # Compile, lint, run core unit tests, then Extension Host integration tests
npm test -- "name"   # Run Extension Host tests whose names contain the given text
npm run test:unit    # Run formatter fixtures against the core in plain Node
npm run package      # Compile and build the VSIX with scripts/package-vsix.mjs
```

Press F5 in VS Code to compile and run the extension in an Extension Development Host. The launch configuration loads `out/**/*.js` and invokes the `npm: compile` pre-launch task. Files under `out/` are generated and ignored by Git; `npm run package` rebuilds them before packaging.

Keep external dependencies to the minimum. The only devDependencies are `typescript`, `@types/node`, and `@types/vscode`; packaging and the VS Code test host are in-repo replacements for `@vscode/vsce` and `@vscode/test-electron`. Do not add npm packages for tooling that Node's standard library can cover.

`npm test` resolves VS Code from the official update service, verifies the archive's SHA-256, and caches the build in `.vscode-test/`; set `VSCODE_TEST_VERSION` to pin a version. Formatter cases are sanitized input/expected pairs under `src/test/fixtures/formatter/` and are discovered automatically. Keep each pair focused on one behavior. The runner checks exact output and requires the second formatting pass to be a no-op.

## Architecture

- `package.json` is the integration hub: it activates on the `lpc` language, maps `.lpc`, `.c`, and `.h`, contributes the TextMate grammar and formatter settings, and declares the `lpc.format` command.
- `src/extension.ts` creates one `LPCDocumentFormattingEditProvider` for both whole-document and range formatting. The command delegates to VS Code's standard `editor.action.formatDocument`.
- `src/formatter.ts` contains the formatter core (`LPCFormatter`) and must not import `vscode`; `src/formatProvider.ts` is the editor adapter that reads settings per document, expands ranges, and converts output to the document's line endings. The core pipeline preprocesses compound lines, performs a lightweight structural pass for brace-less control nesting, handles comments/preprocessor/blank lines, computes indentation from persistent state, separates inline comments, normalizes only unprotected code, updates bracket and LPC-structure stacks, then applies multiline post-processing. Range formatting expands selections to complete lines and seeds the formatter from their existing indentation; whole-document formatting alone applies the configured final newline.
- `src/test/runTest.ts` launches the Extension Development Host through `src/test/vscodeTestHost.ts`; `src/test/suite/index.ts` contains non-fixture integration checks and substring filtering; `src/test/fixtures.ts` discovers formatter fixture pairs for both `src/test/unit/formatter.test.ts` (plain Node) and `src/test/suite/formatterFixtures.ts` (Extension Host).
- `syntaxes/lpc.tmGrammar.json` controls tokenization and highlighting only. `language-configuration.json` separately controls comments, bracket pairs, auto-closing, indentation, and folding. Neither drives the formatter.
- Generated `out/extension.js` is the packaged entry point. `scripts/package-vsix.mjs` packages only an allowlist derived from `package.json` (compiled `out/**/*.js` except tests, language configuration, grammars, README, CHANGELOG, LICENSE); `.vscodeignore` only matters if vsce is ever run directly.

## Repository-specific conventions

- Preserve text inside strings, character literals, and comments while treating quoted symbols such as `'name` as code. Reuse `CharacterScanner`, `replaceOutsideProtectedText()`, `stripCommentsAndStrings()`, and the comment-finding helpers rather than applying regex replacements to an entire raw line.
- Treat LPC structures `({ ... })`, `([ ... ])`, and `(< ... >)` separately from ordinary braces/brackets. Keep all three opener/closer forms synchronized in bracket-stack, indentation, and continuation logic. `#'[` is an operator function reference, not an opening bracket.
- State-update order in `formatLPCCode()` is significant. Indentation is chosen from the structural analysis and current stacks before the formatted line updates brace, LPC-structure, continuation, switch/case, and comment state. Comments, blank lines, and preprocessor directives must not discard an open statement or delimiter context.
- Preserve LDMUD formatting behavior: switch `case` labels use `-cli0` alignment, function and control braces use K&R/brace-right style when they can be moved safely, one-line functions/control statements stay intact, brace-less bodies remain brace-less, and backslash-continued strings and macros retain their content. Four spaces is the default, but the provider must honor VS Code's `insertSpaces`, `tabSize`, and `lpc.formatting.indentSize`.
- Keep formatting idempotent: one pass must converge, especially for nested closures, mappings, multisets, lambdas, continuation lines, and closing sequences such as `}));`.
- Grammar rule order prevents overlapping regexes. Keep operators ordered from specific to general (arrow, compound assignment, shifts, comparison, logical, bitwise, arithmetic, bare assignment, ternary), and keep float matching before decimal matching. Recursive LPC structures and lambdas use `$self`.
- A single quote starts LPC character, symbol, or function-reference syntax. Do not add single-quote auto-closing; it intentionally appears only as a surrounding pair.
- LPC type and modifier lists are centralized as formatter regex constants but remain duplicated in the TextMate grammar. When adding one, update both `syntaxes/lpc.tmGrammar.json` and `src/formatter.ts`, including cast, declaration, and closure post-processing patterns.
- Formatter settings must stay synchronized between `package.json` contributions and the reads in both formatting-provider entry points.
