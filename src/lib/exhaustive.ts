/**
 * Compile-time exhaustiveness guard for a `switch` over a discriminated
 * union: TypeScript only accepts calling this with `never` once every union
 * member has been handled in a preceding branch. The runtime throw only
 * fires if a new member was added to the union without updating its switch
 * — a programming error, never reachable via normal execution, so this is
 * not a "no throw on normal paths" violation.
 */
export const assertUnreachable = (value: never): never => {
  throw new Error(`unreachable case: ${JSON.stringify(value)}`);
};
