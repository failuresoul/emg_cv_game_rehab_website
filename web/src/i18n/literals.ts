/**
 * Finds user-visible text in JSX that does not go through t(): text between tags, and string
 * literals in attributes and props that are shown or read aloud (aria-label, title, label, ...).
 * Used by i18n.test.ts and `npm run i18n:check`. Pure: give it a file's source, get the findings.
 */
import ts from "typescript";

/** Attributes and props whose value people see or hear. */
export const VISIBLE_PROPS = new Set([
  "aria-label",
  "aria-description",
  "aria-valuetext",
  "aria-roledescription",
  "title",
  "placeholder",
  "alt",
  "label",
  "hint",
  "description",
  "emptyTitle",
  "seriesName",
  "ariaLabel",
  "error",
]);

/** Text with at least two letters (Latin or Bengali); symbols, numbers and spaces are fine. */
const WORDS = /[A-Za-zঀ-৿]{2,}/;

export interface Literal {
  line: number;
  text: string;
  kind: "text" | "prop";
  prop?: string;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** A string expression in a visible prop: a literal, or a template without placeholders. */
function literalOf(expression: ts.Expression | undefined): string | null {
  if (!expression) return null;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isParenthesizedExpression(expression)) return literalOf(expression.expression);
  if (ts.isConditionalExpression(expression)) {
    return literalOf(expression.whenTrue) ?? literalOf(expression.whenFalse);
  }
  return null;
}

export function findLiterals(fileName: string, code: string): Literal[] {
  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: Literal[] = [];

  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      const text = node.getText(source).replace(/\s+/g, " ").trim();
      if (WORDS.test(text)) found.push({ line: lineOf(source, node), text, kind: "text" });
    } else if (ts.isJsxExpression(node) && node.parent && ts.isJsxElement(node.parent)) {
      // {"Words"} between tags.
      const text = literalOf(node.expression);
      if (text !== null && WORDS.test(text)) {
        found.push({ line: lineOf(source, node), text, kind: "text" });
      }
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source);
      if (VISIBLE_PROPS.has(name) && node.initializer) {
        const text = ts.isStringLiteral(node.initializer)
          ? node.initializer.text
          : ts.isJsxExpression(node.initializer)
            ? literalOf(node.initializer.expression)
            : null;
        if (text !== null && WORDS.test(text)) {
          found.push({ line: lineOf(source, node), text, kind: "prop", prop: name });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return found;
}
