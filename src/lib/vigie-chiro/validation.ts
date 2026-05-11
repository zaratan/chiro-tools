/**
 * Validators for the 4 fields of the Vigie-Chiro form.
 *
 * Convention: each function returns `null` when the value is valid,
 * or a French error message ready to display in the UI.
 */

/**
 * Validates the Vigie-Chiro square code (6 digits, department in first 2).
 *
 * @returns `null` if valid (exactly 6 digits), otherwise a French UI message.
 */
export const validateSquareCode = (v: string): string | null => {
  if (!/^\d*$/.test(v)) {
    return "Le code ne doit contenir que des chiffres.";
  }

  const count = v.length;
  if (count !== 6) {
    return `Il faut exactement 6 chiffres (vous en avez tapé ${count.toString()}).`;
  }

  return null;
};

/**
 * Validates the survey session year.
 *
 * @returns `null` if valid (4 digits, between 1900 and 2100), otherwise a French UI message.
 */
export const validateYear = (v: string): string | null => {
  if (!/^\d{4}$/.test(v)) {
    return "L'année doit être sur 4 chiffres (ex : 2026).";
  }

  const year = parseInt(v, 10);
  if (year < 1900 || year > 2100) {
    return "L'année doit être comprise entre 1900 et 2100.";
  }

  return null;
};

/**
 * Validates the pass number (which visit of the year this is, 1-based).
 *
 * @returns `null` if valid (positive integer >= 1), otherwise a French UI message.
 */
export const validatePassNumber = (v: string): string | null => {
  if (!/^\d+$/.test(v)) {
    return "Le passage doit être un nombre entier supérieur ou égal à 1.";
  }

  const passNumber = parseInt(v, 10);
  if (passNumber < 1) {
    return "Le passage doit être un nombre entier supérieur ou égal à 1.";
  }

  return null;
};

/**
 * Validates the listening point code (one letter followed by one digit).
 *
 * Lowercase is accepted — uppercase normalization happens in `buildPrefix`.
 *
 * @returns `null` if valid, otherwise a French UI message.
 */
export const validatePointCode = (v: string): string | null => {
  if (!/^[A-Za-z]\d$/.test(v)) {
    return "Format attendu : une lettre puis un chiffre (ex : A1).";
  }

  return null;
};
