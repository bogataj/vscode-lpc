# Repository instructions

VS Code extension for LPC as implemented by the LDMUD driver (LP-245 mudlib): a TextMate
grammar, language configuration, and a document/range formatter. The extension claims
only `.lpc`; mudlib workspaces opt in to `.c`/`.h` through `files.associations`.

These instructions are for every coding agent. `AGENTS.md` is the source, read by Codex
and other agents; `.github/copilot-instructions.md` is an identical copy for GitHub
Copilot, and `CLAUDE.md` imports `AGENTS.md`. Edit `AGENTS.md`, then run
`npm run sync:instructions`; the unit tests fail when the two copies differ.

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

## Testing

- A change is done when `npm test` passes. Use `npm run test:unit` while iterating; it
  takes well under a second.
- `npm test` ends by launching VS Code. The first run downloads it to `.vscode-test/`,
  and a window opens briefly. On Linux without a display, run `xvfb-run -a npm test`.
- A formatter change needs a fixture pair in `src/test/fixtures/formatter/` that shows
  the behavior. Every fixture is checked three ways: the output equals the expected
  file, a second pass changes nothing, and only whitespace differs from the input.
- When a change alters an existing expected file, read the difference and make sure it
  is intended; do not regenerate expected files to make the tests pass.
- Editor behavior (settings, range formatting, line endings, commands) is tested in the
  Extension Host suite: `src/test/suite/index.ts` and `src/test/suite/providerTests.ts`.
  Grammar patterns are asserted in the "grammar recognizes LPC syntax patterns" test.
- CI (`.github/workflows/ci.yml`) runs `npm test` on Ubuntu with current VS Code, on
  Ubuntu with VS Code 1.74.0, and on Windows. The `test` job reports the whole matrix.

## Changes and pull requests

- `main` is protected: it only accepts pull requests, and the `test` check must pass.
  Work on a branch, push it, and open a pull request; do not push to `main`.
- Describe user-visible changes under `## [Unreleased]` in `CHANGELOG.md`, grouped as
  Fixed, Added, Changed, or Breaking. Update `README.md` and the setting descriptions in
  `package.json` when behavior or settings change.
- Commit subjects are imperative and say what changed; the body explains why.

## Releasing

Release only when the maintainer asks for it.

1. Choose the version: patch for fixes that leave already formatted files unchanged,
   minor for new features or changes to formatter output, major for breaking changes.
2. Set it in `package.json` and in both places at the top of `package-lock.json`. In
   `CHANGELOG.md`, put the unreleased entries under `## [X.Y.Z] - YYYY-MM-DD` and leave
   an empty `## [Unreleased]` above it. Commit this as `vX.Y.Z: summary`.
3. Merge the pull request once `test` is green, with a rebase merge so the version
   commit stays separate.
4. Tag that commit on `main` and push the tag: `git tag vX.Y.Z` and
   `git push origin vX.Y.Z`. The tag must match the version in `package.json`.
5. Run the Release workflow: `gh workflow run release.yml -f tag=vX.Y.Z`. It tests,
   packages, and publishes a GitHub release with the VSIX and its SHA-256 file.
6. Download the result into an empty folder and check it:
   `gh release download vX.Y.Z --dir dist/vX.Y.Z`, then `sha256sum --check` on the
   `.sha256` file in that folder. `dist/` is ignored by git.
7. The maintainer uploads that VSIX to the Visual Studio Marketplace by hand. There is
   no publisher token: do not run `vsce publish` or add `vsce` as a dependency.

## Layout

- `src/formatter.ts` — `LPCFormatter`, the formatter core. It must not import `vscode`.
- `src/formatProvider.ts` — editor adapter: reads settings for the document
  (`readFormatSettings`), converts output to the document's line endings, returns no
  edits when cancelled. Range formatting formats the whole document and returns the
  selected lines of the result.
- `src/formatRange.ts` — `mapFormattedLineRange()`, which finds those lines by counting
  non-whitespace characters. It must not import `vscode`.
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
- Formatting changes whitespace only: the non-whitespace characters of the output equal
  those of the input, in order. The unit tests check this for every fixture, and range
  formatting relies on it.
- Never change text in strings, character literals, or comments. A block comment is only
  re-indented: lines starting with `*` align under the opening `/*`, other lines keep
  their position relative to it. Quoted symbols (`'name`) are code. Closure references
  (`#'name`, `#'[<`, `#'({`) are single operands whose brackets are not delimiters;
  `CharacterScanner` skips them. Use `CharacterScanner`, `computeProtectedMask()`,
  `replaceOutsideProtectedText()`, and `stripCommentsAndStrings()` rather than regexes
  over raw lines.
- Treat `({ })`, `([ ])`, and `(< >)` separately from ordinary brackets and keep all
  three in sync in the bracket-stack, indentation, and continuation logic.
- In `format()`, indentation is decided before the line updates brace, structure,
  continuation, switch, and comment state. Comments, blank lines, and preprocessor
  directives must not drop an open statement or delimiter context.
- Layout rules: brace placement is preserved; brace-less bodies stay brace-less;
  `case` labels align with their `switch`; one-line statements are kept;
  single-statement functions are compacted when the line fits in 80 columns, unless
  `lpc.formatting.compactSingleStatementFunctions` is false. A comment that ends a
  line keeps its distance from the start of the code. Lines aligned to a column
  (continued strings, ternary branches) use the anchor line's tabs plus spaces when
  indenting with tabs.
- Spacing is C style, applied by the token pass `normalizeOperatorSpacing()`; it may
  only change whitespace between tokens and must leave LPC syntax (`int|string`,
  `<int|string>*`, `[<1..<2]`, `#'>`, `(<Foo>`) alone.
- `lpc.formatting.indentSize` (default 4) takes precedence over the editor tab size;
  with tabs, each level is one tab.
- Keep the type and modifier lists in `src/formatter.ts` and the grammar in sync.
  Grammar operator rules go from specific to general; floats match before decimals.
- Do not auto-close single quotes: `'` also starts symbols and closure references.
