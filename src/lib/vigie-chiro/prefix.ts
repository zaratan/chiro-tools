import type { FormInput } from "../../types.js";

/**
 * Builds the Vigie-Chiro filename prefix from a validated form input.
 *
 * Field validation is assumed to have been performed by the UI layer.
 * The point code is normalized to uppercase here.
 *
 * @returns The prefix in the format `CarXXXXXX-AAAA-PassN-YY-` (Vigie-Chiro standard).
 */
export const buildPrefix = (input: FormInput): string => {
  return `Car${input.squareCode}-${input.year.toString()}-Pass${input.passNumber.toString()}-${input.pointCode.toUpperCase()}-`;
};
