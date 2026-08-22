# LPC Language Support (LDMUD/LP-245)

A Visual Studio Code extension providing syntax highlighting, editor configuration, and code formatting for LPC (Lars Pensjö C) used with the LDMUD game driver and LP-245 mudlib.

**Author**: Andreas Bogataj (andreas@bogga.se)

## Overview

This extension is specifically tailored for LDMUD's implementation of LPC and battle-tested with the LP-245 mudlib. It provides TextMate syntax highlighting, LPC-aware editor behavior, and a production-grade code formatter.

## Features

### Comprehensive Syntax Highlighting

Syntax highlighting for LPC/LDMUD language constructs:

- **Keywords & Control Flow**: `if`, `else`, `for`, `foreach`, `while`, `switch`, `case`, `default`, `break`, `continue`, `return`
- **Data Types**: `void`, `int`, `float`, `string`, `object`, `mapping`, `mixed`, `closure`, `symbol`, `bytes`, `struct`, `lwobject`, `coroutine`
- **Modifiers**: `public`, `private`, `protected`, `static`, `nomask`, `varargs`, `deprecated`
- **LDMUD Efuns**: Built-in functions such as `write()`, `tell_object()`, `clone_object()`, and `call_out()`
- **Apply Functions**: Common applies such as `create()`, `init()`, `heart_beat()`, and `reset()`
- **Preprocessor Directives**: `#include`, `#define`, `#ifdef`, `#ifndef`, `#pragma`
- **Special Constructs**: Function pointers `#'`, closures `({})`, lambda expressions, inline closures

### Production-Grade Code Formatter

The formatter has been extensively tested and refined on real-world codebases with zero-diff validation on comprehensive test suites.

**Smart Indentation:**
- Context-aware indentation for nested blocks
- Correct nesting for brace-less controls and dangling `else` clauses
- Switch/case statement handling with LDMUD `-cli0` style (case labels at same indent as switch)
- Multi-line statement continuation with proper alignment
- Bracket stack tracking for complex nested structures
- Comments, blank lines, and preprocessor directives preserve active statement context

**LPC-Specific Features:**
- **Closure Syntax Protection**: Patterns like `( ({ ... })` preserved correctly
- **String Literal Safety**: String content never modified (e.g., paths like `"/std/object"`)
- **Backslash String Continuations**: Multi-line strings with `\` line continuation handled properly
- **Data Structure Formatting**: Arrays `({})`, mappings `([])`, and multisets `(<>)` formatted consistently
- **Comment Preservation**: Inline and block comments maintain proper spacing and alignment

**Operator Spacing:**
- Consistent spacing around binary operators: `+`, `-`, `*`, `/`, `%`, `==`, `!=`, `<`, `>`, `<=`, `>=`
- Compound assignment operators: `+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `|=`, `^=`
- Ternary operator alignment: `? :`
- Logical operators: `&&`, `||`, `!`
- Bitwise operators: `&`, `|`, `^`, `~`, `<<`, `>>`
- C-style control keywords and compact LPC member access: `if (...)`, `object->method()`
- Brace-right control blocks and joined `} else {` clauses

**Edge Case Handling:**
- One-liner function and control statement preservation
- Token-preserving formatting: brace-less bodies remain brace-less and valid trailing commas remain intact
- Inline comments containing brace characters
- Nested function calls and closures
- Complex lambda expressions
- Mixed data structure declarations
- Deeply nested structures with closing patterns like `}));` and `}) ) )`

### Editor Behavior

- Auto-closes `/*` comments outside strings and existing comments
- Continues `//` comments when Enter is pressed
- Continues `/** ... */` documentation comments with leading `*`
- Provides LPC-aware bracket pairs, folding, and indentation rules

### Configuration

Customize the formatter through VS Code settings:

```json
{
    "lpc.formatting.enabled": true,
    "lpc.formatting.indentSize": 4,
    "lpc.formatting.insertFinalNewline": true
}
```

**Available Settings:**
- `lpc.formatting.enabled` - Enable/disable formatting (default: `true`)
- `lpc.formatting.indentSize` - Spaces per indent level (default: `4`)
- `lpc.formatting.insertFinalNewline` - Add newline at EOF (default: `true`)

## Supported File Extensions

- `.lpc` - LPC source files
- `.c` - LPC source files (common convention)
- `.h` - LPC header files

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "LPC Language Support for LDMUD"
4. Click Install

## Development

Development requires Node.js 20.19 or newer:

```bash
git clone https://github.com/bogataj/vscode-lpc
cd vscode-lpc
npm install
npm run compile
npm run lint
npm test
npm run package
```

Build output under `out/` is generated locally and is not committed. Packaging
rebuilds it automatically through the `vscode:prepublish` script.

Run one integration test by passing part of its name:

```bash
npm test -- "nested switches"
```

Formatter regressions live as isolated input/expected pairs under
`src/test/fixtures/formatter/`. `npm test` discovers every pair automatically,
checks its expected output, and verifies that a second formatting pass is a no-op.

Press F5 to compile the extension and open a new Extension Development Host.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests at:
https://github.com/bogataj/vscode-lpc

## License

MIT License - see LICENSE file for details.

## Related Links

- [LDMUD Official Website](http://www.ldmud.eu/)
- [LDMUD GitHub Repository](https://github.com/ldmud/ldmud)
- [LPC Language Documentation](http://www.ldmud.eu/doc/)

## Changelog

For complete version history, bug fixes, and new features, see [CHANGELOG.md](CHANGELOG.md).