import path from "node:path";
import type { FormInput } from "../../types.js";
import { extractCommonPrefix } from "./extractCommonPrefix.js";
import { isAlreadyPrefixed } from "./isAlreadyPrefixed.js";
import {
  validatePassNumber,
  validatePointCode,
  validateSquareCode,
  validateYear,
} from "./validation.js";

const PREFIX_FIELDS_REGEX = /^Car(\d+)-(\d+)-Pass(\d+)-([^-]+)-$/;

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

export const formInputFromPrefix = (prefix: string): FormInput | null => {
  const [, squareCode, year, passNumber, pointCode] =
    PREFIX_FIELDS_REGEX.exec(prefix) ?? [];
  if (
    squareCode === undefined ||
    year === undefined ||
    passNumber === undefined ||
    pointCode === undefined ||
    validateSquareCode(squareCode) !== null ||
    validateYear(year) !== null ||
    validatePassNumber(passNumber) !== null ||
    validatePointCode(pointCode) !== null
  ) {
    return null;
  }
  const input: FormInput = {
    squareCode,
    year: Number(year),
    passNumber: Number(passNumber),
    pointCode,
  };
  return buildPrefix(input) === prefix ? input : null;
};

export const readCommonFormInput = (
  files: readonly string[],
): FormInput | null => {
  const common = extractCommonPrefix(
    files.filter(isAlreadyPrefixed).map((file) => path.basename(file)),
  );
  return common === null ? null : formInputFromPrefix(`${common}-`);
};
