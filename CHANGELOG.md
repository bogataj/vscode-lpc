# Change Log

All notable changes to the "LPC Language Support" extension will be documented in this file.

## [1.0.0] - 2025-01-XX

### Added
- Initial release of LPC Language Support for LDMUD
- Comprehensive syntax highlighting for LPC language constructs
- Advanced code formatter with LDMUD conventions support:
  - LDMUD `-cli0` case label indentation (case at switch body level)
  - LDMUD `-i4` 4-space indentation
  - LDMUD `-br` brace-right style
  - Proper handling of LPC data structures: arrays `({})`, mappings `([])`, multisets `(<>)`
  - Smart indentation for nested function calls and lambda expressions
  - Continuation line handling for multi-line statements
- Language configuration for brackets, auto-closing pairs, and comments
- Support for `.lpc`, `.c`, and `.h` file extensions
- LDMUD-specific keywords, efuns, and applies highlighting
- Function pointer syntax highlighting `#'function_name`
- Lambda expression support `(: $1 + $2 :)`

### Features
- Document formatting (Format Document)
- Range formatting (Format Selection)
- Manual format command (`lpc.format`)
- Configurable indentation settings
- Full bracket pair matching for LPC structures

### Formatter Highlights
- Correctly formats switch statements according to LDMUD `-cli0` convention
- Handles complex nested LPC data structures with stack-based tracking
- Supports continuation indentation for multi-line function calls
- Properly aligns closing parentheses with their opening context
- Maintains consistent indentation for lambda bodies and closures
- Special handling for mapping elements and nested structures

## [Unreleased]

### Planned
- Code snippets for common LPC patterns
- Hover documentation for LDMUD efuns
- Auto-completion for LDMUD functions
- Signature help for function parameters
