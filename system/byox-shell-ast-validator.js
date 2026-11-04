/**
 * ULTRON AI — BYOX Shell Tokenizer & AST Security Validator
 *
 * Derived from Build Your Own X concepts:
 * - Stephen Brennan: Tutorial - Write a Shell in C (Lexing, parsing, execution loop)
 * - Kamal Marhubi: Let's build a shell! (Pipeline AST, quote handling)
 * - tokenrove: Build Your Own Shell
 *
 * Implements tokenization, Abstract Syntax Tree (AST) parsing, and strict security validation
 * for command execution pipelines without vulnerable shell string interpolation.
 */

export class ByoxShellAstValidator {
  constructor(options = {}) {
    this.allowedBinaries = new Set(options.allowedBinaries || [
      'node', 'npm', 'git', 'python', 'whoami', 'hostname', 'ipconfig', 'dir', 'echo'
    ]);

    this.blockedPatterns = [
      /rmdir\s+\/s/i,
      /del\s+\/f/i,
      /format\s+[a-z]:/i,
      /reg\s+delete/i,
      /net\s+user/i,
      /shutdown/i,
      /taskkill\s+\/f/i
    ];
  }

  /**
   * Tokenize command string into arguments preserving quotes and escapes.
   */
  tokenize(commandStr) {
    if (!commandStr || typeof commandStr !== 'string') return [];

    const tokens = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    let escaped = false;

    for (let i = 0; i < commandStr.length; i++) {
      const char = commandStr[i];

      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (inQuotes) {
        if (char === quoteChar) {
          inQuotes = false;
          quoteChar = '';
        } else {
          current += char;
        }
      } else {
        if (char === '"' || char === "'") {
          inQuotes = true;
          quoteChar = char;
        } else if (/\s/.test(char)) {
          if (current.length > 0) {
            tokens.push(current);
            current = '';
          }
        } else if (char === '|' || char === ';' || char === '&') {
          if (current.length > 0) {
            tokens.push(current);
            current = '';
          }
          // Check for multi-char operators like && or ||
          if ((char === '&' && commandStr[i + 1] === '&') || (char === '|' && commandStr[i + 1] === '|')) {
            tokens.push(char + commandStr[i + 1]);
            i++;
          } else {
            tokens.push(char);
          }
        } else {
          current += char;
        }
      }
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  }

  /**
   * Parse token stream into an Abstract Syntax Tree (AST).
   */
  parseAst(tokens) {
    const pipeline = [];
    let currentCommand = null;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (token === '|') {
        if (!currentCommand) {
          throw new Error('Syntax error: unexpected pipe operator without preceding command');
        }
        pipeline.push(currentCommand);
        currentCommand = null;
      } else if (token === '&&' || token === '||' || token === ';') {
        throw new Error(`Forbidden shell chaining operator: ${token}`);
      } else {
        if (!currentCommand) {
          currentCommand = {
            executable: token,
            args: []
          };
        } else {
          currentCommand.args.push(token);
        }
      }
    }

    if (currentCommand) {
      pipeline.push(currentCommand);
    }

    return {
      type: 'Pipeline',
      commands: pipeline
    };
  }

  /**
   * Validate AST against security allowlists and blocked patterns.
   */
  validateAst(ast) {
    if (!ast || ast.type !== 'Pipeline' || !Array.isArray(ast.commands) || ast.commands.length === 0) {
      return { allowed: false, reason: 'INVALID_AST' };
    }

    for (const cmd of ast.commands) {
      const baseExe = cmd.executable.toLowerCase().replace(/\.exe$/i, '');

      if (!this.allowedBinaries.has(baseExe)) {
        return {
          allowed: false,
          reason: 'DISALLOWED_BINARY',
          executable: cmd.executable
        };
      }

      // Check full command line args against destructive patterns
      const fullLine = `${cmd.executable} ${cmd.args.join(' ')}`;
      for (const pattern of this.blockedPatterns) {
        if (pattern.test(fullLine)) {
          return {
            allowed: false,
            reason: 'DESTRUCTIVE_PATTERN_DETECTED',
            pattern: pattern.toString(),
            command: fullLine
          };
        }
      }
    }

    return {
      allowed: true,
      commands: ast.commands
    };
  }

  /**
   * Single-step tokenize, parse, and validate.
   */
  validateCommand(commandStr) {
    const tokens = this.tokenize(commandStr);
    try {
      const ast = this.parseAst(tokens);
      return this.validateAst(ast);
    } catch (err) {
      return {
        allowed: false,
        reason: 'PARSE_ERROR',
        error: err.message
      };
    }
  }
}
