# LPC Language Support (LDMUD/LP-245)

A comprehensive Visual Studio Code extension that provides language support for LPC (LPC Programming Language) used with the **LDMUD game driver** and **LP-245 mudlib**.

**Author**: Andreas Bogataj (andreas@bogga.se)

This extension is specifically tailored for LDMUD's implementation of LPC and follows the LP-245 mudlib conventions, including:
- LDMUD-specific formatting rules (`-cli0` case label indentation)
- LP-245 coding standards
- LDMUD efuns and applies
- LPC-specific data structures: `({})` arrays, `([])` mappings, `(<>)` multisets

## Features

- **Syntax Highlighting**: Full syntax highlighting for LPC language constructs
- **Code Formatting**: Automatic code formatting with configurable indentation
- **Language Configuration**: Support for comments, brackets, and auto-pairing
- **LDMUD Specific**: Tailored for LDMUD efuns, applies, and language features

## Supported File Extensions

- `.lpc` - LPC source files
- `.c` - LPC source files (common convention)
- `.h` - LPC header files

## Language Features

### Syntax Highlighting

The extension provides comprehensive syntax highlighting for:

- **Keywords**: `if`, `else`, `for`, `foreach`, `while`, `do`, `switch`, `case`, `default`
- **Types**: `void`, `int`, `float`, `string`, `object`, `mapping`, `mixed`, `array`
- **Modifiers**: `public`, `private`, `protected`, `static`, `nomask`, `varargs`
- **LDMUD Efuns**: All built-in functions like `write()`, `tell_object()`, `clone_object()`
- **Apply Functions**: Standard applies like `create()`, `init()`, `heart_beat()`
- **Data Structures**: Arrays `({})`, Mappings `([])`, Multisets `(<>)`

### Code Formatting

Automatic code formatting includes:
- Proper indentation for blocks, functions, and control structures
- Consistent spacing around operators
- Alignment of function parameters
- Support for LPC-specific constructs

### Configuration

The extension can be configured through VS Code settings:

```json
{
    "lpc.formatting.enabled": true,
    "lpc.formatting.indentSize": 4,
    "lpc.formatting.insertFinalNewline": true
}
```

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

See [CHANGELOG.md](CHANGELOG.md) for full version history.

### 1.2.1 - 2025-10-18
- Added macro/constant highlighting for preprocessor defines and all-uppercase identifiers
- Fixed closing parenthesis alignment in deeply nested lambda/closure structures
- Added special handling for #'[ operator syntax

### 1.2.0 - 2025-10-18
- Comprehensive whitespace normalization with advanced spacing rules
- Enhanced function pointer syntax highlighting
- Critical string protection ensuring string literals are never modified
- Zero-diff formatting achieved on comprehensive test suite

### 1.0.0
- Initial release
- Basic syntax highlighting
- Code formatting support
- Language configuration for LPC