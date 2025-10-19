# LPC Language Support (LDMUD/LP-245)

A comprehensive Visual Studio Code extension providing production-quality language support for LPC (Lars Pensjö C) used with the LDMUD game driver and LP-245 mudlib.

**Author**: Andreas Bogataj (andreas@bogga.se)

## Overview

This extension is specifically tailored for LDMUD's implementation of LPC and battle-tested with the LP-245 mudlib. It provides complete syntax highlighting, a production-grade code formatter, and full language support for LDMUD-specific constructs.

## Features

### Comprehensive Syntax Highlighting

Complete syntax support for all LPC/LDMUD language constructs:

- **Keywords & Control Flow**: `if`, `else`, `for`, `foreach`, `while`, `switch`, `case`, `default`, `break`, `continue`, `return`
- **Data Types**: `void`, `int`, `float`, `string`, `object`, `mapping`, `mixed`, `closure`, `symbol`, `bytes`, `struct`, `lwobject`, `coroutine`
- **Modifiers**: `public`, `private`, `protected`, `static`, `nomask`, `varargs`, `deprecated`
- **LDMUD Efuns**: All built-in functions like `write()`, `tell_object()`, `clone_object()`, `call_out()`, etc.
- **Apply Functions**: Standard applies like `create()`, `init()`, `heart_beat()`, `reset()`
- **Preprocessor Directives**: `#include`, `#define`, `#ifdef`, `#ifndef`, `#pragma`
- **Special Constructs**: Function pointers `#'`, closures `({})`, lambda expressions, inline closures

### Production-Grade Code Formatter

The formatter has been extensively tested and refined on real-world codebases with zero-diff validation on comprehensive test suites.

**Smart Indentation:**
- Context-aware indentation for nested blocks
- Switch/case statement handling with LDMUD `-cli0` style (case labels at same indent as switch)
- Multi-line statement continuation with proper alignment
- Bracket stack tracking for complex nested structures

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

**Edge Case Handling:**
- One-liner function and control statement preservation
- Inline comments containing brace characters
- Nested function calls and closures
- Complex lambda expressions
- Mixed data structure declarations
- Deeply nested structures with closing patterns like `}));` and `}) ) )`

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

To develop this extension:

```bash
git clone https://github.com/bogataj/vscode-lpc
cd vscode-lpc
npm install
npm run compile
```

Press F5 to open a new VS Code window with the extension loaded.

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