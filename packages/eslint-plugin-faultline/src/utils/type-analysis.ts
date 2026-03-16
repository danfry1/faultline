import ts from 'typescript';

/**
 * Recursively extracts error tag strings from a TypeScript type.
 *
 * Given a type like `AppError<'User.NotFound', ...> | AppError<'User.Unauthorized', ...>`,
 * returns `['User.NotFound', 'User.Unauthorized']`.
 *
 * Handles: direct AppError types, union types, type arguments from
 * TypedPromise<T, E>, Result<T, E>, TaskResult<T, E>, and Promise<Result<T, E>>.
 */
export function extractErrorTagsFromType(
  checker: ts.TypeChecker,
  type: ts.Type,
): string[] {
  const tags = new Set<string>();

  function visit(t: ts.Type, depth: number): void {
    if (depth > 6) return;

    // Check if this type has _tag as a string literal
    const tagProp = t.getProperty('_tag');
    if (tagProp) {
      const tagType = checker.getTypeOfSymbol(tagProp);
      if (tagType.isStringLiteral()) {
        tags.add(tagType.value);
        return;
      }
      if (tagType.isUnion()) {
        for (const member of tagType.types) {
          if (member.isStringLiteral()) {
            tags.add(member.value);
          }
        }
        return;
      }
    }

    // Decompose union types
    if (t.isUnion()) {
      for (const member of t.types) {
        visit(member, depth + 1);
      }
      return;
    }

    // Recurse into type arguments (Promise<X>, Result<T, E>, etc.)
    const typeArgs = (t as ts.TypeReference).typeArguments;
    if (typeArgs) {
      for (const arg of typeArgs) {
        visit(arg, depth + 1);
      }
    }
  }

  visit(type, 0);

  // Filter out discriminants that aren't error tags
  tags.delete('ok');
  tags.delete('err');

  return [...tags];
}

/**
 * Extracts error tags from _output phantom type of an error group/factory.
 */
export function extractErrorTagsFromOutputType(
  checker: ts.TypeChecker,
  type: ts.Type,
): string[] {
  // Direct _output property (ErrorFactory or ErrorGroup)
  const outputProp = type.getProperty('_output');
  if (outputProp) {
    const outputType = checker.getTypeOfSymbol(outputProp);
    return extractErrorTagsFromType(checker, outputType);
  }

  // Check if it's an object whose properties have _output (ErrorGroup shape)
  const tags: string[] = [];
  for (const prop of type.getProperties()) {
    const propType = checker.getTypeOfSymbol(prop);
    const propOutput = propType.getProperty('_output');
    if (propOutput) {
      const outputType = checker.getTypeOfSymbol(propOutput);
      tags.push(...extractErrorTagsFromType(checker, outputType));
    }
  }

  return tags;
}
