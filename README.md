# LPC Language Support (LDMUD/LP-245)

Syntax highlighting, editor support, and a formatter for LPC as implemented by the
[LDMUD](https://www.ldmud.eu/) driver, tuned for the LP-245 mudlib.

**Author**: Andreas Bogataj (andreas@bogga.se)

## Using it with .c and .h files

The extension only claims `.lpc` files, so ordinary C projects are not affected.
Mudlibs usually keep LPC in `.c` and `.h` files; to treat them as LPC in a workspace,
run **LPC: Treat .c/.h Files as LPC in This Workspace** from the Command Palette, or
add this to the workspace's `.vscode/settings.json`:

```json
{
    "files.associations": { "*.c": "lpc", "*.h": "lpc" }
}
```

## Features

**Highlighting** for LDMUD keywords, types (including `lwobject`, `coroutine`, union
types), modifiers, efuns and applies (when called), closures (`#'name`, `(: :)`,
`lambda`), arrays, mappings, multisets, struct literals, and preprocessor directives.

**Editor support**: comment toggling and continuation, auto-closing of `({`, `([`,
`(<` and `/*`, and folding for `#if`/`#ifdef`/`#ifndef` … `#endif` and `#region`.

**Formatting** with *Format Document*, *Format Selection*, or **LPC: Format LPC Code**:

- Indents nested blocks, brace-less `if`/`else`/loop bodies (including dangling `else`),
  continuation lines, and multi-line arrays, mappings, multisets, and closures.
- Indents `case` labels at the level of their `switch` (LDMUD `-cli0` style).
- Keeps brace placement, brace-less bodies, one-line statements, trailing commas,
  comments, strings, and `\`-continued strings and macros as written.
- Keeps the indentation context across comments, blank lines, and `#if` branches.
- Uses C-style spacing, since LPC has no style guide of its own:
  - one space around binary and assignment operators (`a == b`, `x <<= 1`, `a ? b : c`);
  - none after unary operators (`-x`, `!ok`, `&ref`) or around `->`, `.`, and `::`;
  - one space after commas and `for` semicolons; `"key": value` in mappings and
    struct literals; `case 1:`; `foreach (x : items)`; `if (…)`, `while (…)`;
  - LPC syntax stays as written: `int|string`, `<int|string>*`, `arr[<1..<2]`,
    `#'>`, `(<Foo>`.
- Puts functions with one simple statement on one line, such as
  `int query_level() { return level; }` (can be turned off).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `lpc.formatting.enabled` | `true` | Enable the formatter. |
| `lpc.formatting.indentSize` | `4` | Spaces per indentation level. Takes precedence over the editor's tab size; with tabs, each level is one tab. |
| `lpc.formatting.insertFinalNewline` | `true` | End formatted documents with a newline. |
| `lpc.formatting.compactSingleStatementFunctions` | `true` | Put functions with a single simple statement on one line. |

All settings can be set per user, workspace, or folder.

## Development

Requires Node.js 24.11 or newer.

```bash
npm install
npm test            # compile, type-check, unit tests in Node, then tests in VS Code
npm run test:unit   # formatter fixtures only, without VS Code
npm run package     # build the .vsix
```

Formatter cases are input/expected pairs in `src/test/fixtures/formatter/`; each must
match exactly and stay unchanged by a second pass. `npm test -- "name"` runs matching
VS Code tests, and `VSCODE_TEST_VERSION=1.74.0` tests an older VS Code. Press F5 to
launch an Extension Development Host.

The only dependencies are `typescript`, `@types/node`, and `@types/vscode`. Packaging
(`scripts/package-vsix.mjs`) and the VS Code test host (`src/test/vscodeTestHost.ts`)
are part of the repository instead of `vsce` and `@vscode/test-electron`.

Releases: after CI is green on `main`, push a `vX.Y.Z` tag matching `package.json`
and run the **Release** workflow, which tests, packages, and publishes the GitHub
release. Upload its `.vsix` to the Marketplace manually.

## Links

- [Changelog](https://github.com/bogataj/vscode-lpc/blob/HEAD/CHANGELOG.md)
- [Issues](https://github.com/bogataj/vscode-lpc/issues)
- [LDMUD on GitHub](https://github.com/ldmud/ldmud) and its [documentation](https://github.com/ldmud/ldmud/tree/master/doc)

MIT License.
