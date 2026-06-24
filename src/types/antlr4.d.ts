declare module 'antlr4' {
  export interface Token {
    text: string;
    type: number;
    start: number;  // character offset of first character
    stop: number;   // character offset of last character
    line: number;
    column: number;
  }

  export interface TerminalNode {
    symbol: Token | undefined;
    getText(): string;
  }

  export interface ParseTreeNode {
    constructor: { name: string };
    children: ParseTreeNode[] | undefined;
    symbol: Token | undefined;
    start: Token | undefined;  // first token
    stop: Token | undefined;   // last token
    getText(): string;
  }

  export class InputStream {
    constructor(input: string);
  }

  export class CommonTokenStream {
    constructor(lexer: Lexer);
  }

  export class Lexer {
    constructor(input: InputStream);
  }

  export class Parser {
    constructor(input: CommonTokenStream);
    removeErrorListeners(): void;
    addErrorListener(listener: BaseErrorListener): void;
  }

  export interface BaseErrorListener {
    syntaxError<T, U>(
      recognizer: T,
      offendingSymbol: U,
      line: number,
      column: number,
      message: string,
      e: RecognitionException | undefined,
    ): void;
    reportAmbiguity(): void;
    reportAttemptingFullContext(): void;
    reportContextSensitivity(): void;
  }

  export class RecognitionException extends Error {}
  export class Recognizer<T, U> {}

  export class CharStreams {
    static fromString(input: string): InputStream;
  }

  export class Tree {
    static toStringTree(ctx: ParseTreeNode, parser?: Parser): string;
  }

  const antlr4: {
    InputStream: typeof InputStream;
    CommonTokenStream: typeof CommonTokenStream;
    Lexer: typeof Lexer;
    Parser: typeof Parser;
    CharStreams: typeof CharStreams;
    Tree: typeof Tree;
  };

  export default antlr4;
}

declare module '@neo4j-cypher/antlr4' {
  import { Lexer, Parser, ParseTreeNode } from 'antlr4';

  export class CypherLexer extends Lexer {
    constructor(input: any);
  }

  export class CypherParser extends Parser {
    constructor(input: any);
    cypher(): ParseTreeNode;
  }

  export class CypherListener {}
}
