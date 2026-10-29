# Repository instructions

VS Code extension for LPC as implemented by the LDMUD driver (LP-245 mudlib): a TextMate
grammar, language configuration, and a document/range formatter. The extension claims
only `.lpc`; mudlib workspaces opt in to `.c`/`.h` through `files.associations`.

## Commands

Use Node.js 24.11 or newer.

```bash
npm run compile      # clean and compile src/ to out/ (generated, not committed)
npm run lint         # strict tsc checks for src/ and scripts/ (there is no ESLint)
npm test             # compile, lint, core unit tests in Node, then Extension Host tests
npm test -- "name"   # Extension Host tests whose names contain the text
npm run test:unit    # formatter fixtures against the core in plain Node
npm run package      # compile and build the VSIX with scripts/package-vsix.mjs
```

F5 launches an Extension Development Host. `VSCODE_TEST_VERSION=1.74.0` runs the
Extension Host tests on an older VS Code.

## Layout

- `src/formatter.ts` — `LPCFormatter`, the formatter core. It must not import `vscode`.
- `src/formatProvider.ts` — editor adapter: reads settings for the document
  (`readFormatSettings`), expands ranges to whole lines, converts output to the
  document's line endings, returns no edits when cancelled.
- `src/extension.ts` — registers the providers for `{ language: 'lpc' }` and the
  `lpc.format` and `lpc.associateCFiles` commands.
- `syntaxes/lpc.tmGrammar.json` — highlighting only. `language-configuration.json` —
  comments, brackets, auto-closing, indentation, folding. Neither affects formatting.
- `scripts/package-vsix.mjs` — builds the VSIX from an allowlist derived from
  `package.json`; `.vscodeignore` only matters if `vsce` is run directly.
- Tests: `src/test/fixtures/formatter/*.{input,expected}.lpc` are shared by
  `src/test/unit/formatter.test.ts` (`node:test`) and the Extension Host suite in
  `src/test/suite/`. `src/test/vscodeTestHost.ts` downloads VS Code, verifies its
  SHA-256, and launches the tests with a fresh workspace folder.

## Conventions

- Dependencies: only `typescript`, `@types/node`, and `@types/vscode`. Do not add npm
  packages for tooling that Node's standard library can cover.
- Fixtures use neutral identifiers, focus on one behavior, must match exactly, and must
  be unchanged by a second formatting pass.
- Never change text in strings, character literals, or comments. Quoted symbols
  (`'name`) and closure references (`#'name`, `#'[`) are code. Use `CharacterScanner`,
  `computeProtectedMask()`, `replaceOutsideProtectedText()`, and
  `stripCommentsAndStrings()` rather than regexes over raw lines.
- Treat `({ })`, `([ ])`, and `(< >)` separately from ordinary brackets and keep all
  three in sync in the bracket-stack, indentation, and continuation logic.
- In `format()`, indentation is decided before the line updates brace, structure,
  continuation, switch, and comment state. Comments, blank lines, and preprocessor
  directives must not drop an open statement or delimiter context.
- Layout rules: brace placement is preserved; brace-less bodies stay brace-less;
  `case` labels align with their `switch`; one-line statements are kept;
  single-statement functions are compacted unless
  `lpc.formatting.compactSingleStatementFunctions` is false.
- Spacing is C style, applied by the token pass `normalizeOperatorSpacing()`; it may
  only change whitespace between tokens and must leave LPC syntax (`int|string`,
  `<int|string>*`, `[<1..<2]`, `#'>`, `(<Foo>`) alone.
- `lpc.formatting.indentSize` (default 4) takes precedence over the editor tab size;
  with tabs, each level is one tab.
- Keep the type and modifier lists in `src/formatter.ts` and the grammar in sync.
  Grammar operator rules go from specific to general; floats match before decimals.
- Do not auto-close single quotes: `'` also starts symbols and closure references.
