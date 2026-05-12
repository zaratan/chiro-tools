import { Box, useInput } from "ink";
import { useState } from "react";
import { Footer } from "../../components/Footer.js";
import { TextField } from "../../components/TextField.js";
import {
  validatePassNumber,
  validatePointCode,
  validateSquareCode,
  validateYear,
} from "../../lib/vigie-chiro/validation.js";
import type { FormInput } from "../../types.js";

type FieldKey = "squareCode" | "year" | "passNumber" | "pointCode";

const FIELD_ORDER: readonly FieldKey[] = [
  "squareCode",
  "year",
  "passNumber",
  "pointCode",
];

type FieldValues = Record<FieldKey, string>;
type FieldErrors = Record<FieldKey, string | null>;

const validators: Record<FieldKey, (v: string) => string | null> = {
  squareCode: validateSquareCode,
  year: validateYear,
  passNumber: validatePassNumber,
  pointCode: validatePointCode,
};

const LOWERCASE_POINT_REGEX = /^[a-z]\d$/;

type NumericFieldKey = "year" | "passNumber";

const NUMERIC_FIELD_BOUNDS: Record<
  NumericFieldKey,
  { min: number; max: number }
> = {
  year: { min: 1900, max: 2100 },
  passNumber: { min: 1, max: 9999 },
};

const isNumericField = (key: FieldKey): key is NumericFieldKey =>
  key === "year" || key === "passNumber";

const FIELD_LABELS: Record<FieldKey, string> = {
  squareCode: "Code du carré",
  year: "Année de la session",
  passNumber: "Numéro de passage",
  pointCode: "Code du point d'écoute",
};

const FIELD_HELPS: Record<FieldKey, string> = {
  squareCode:
    "Le numéro à 6 chiffres visible sur la page de votre site Vigie-Chiro. Si le département commence par 1-9, ajoutez un 0 devant (ex : 040962 pour les Landes).",
  year: "Pré-remplie sur cette année. Modifiable si besoin.",
  passNumber:
    "Combien de fois vous êtes déjà passée sur ce point cette année ? (1 pour le premier passage, 2 pour le deuxième, etc.)",
  pointCode:
    "Une lettre suivie d'un chiffre, comme indiqué sur votre plan de carré (A1, B2, C3...).",
};

export type FormScreenProps = {
  onSubmit: (input: FormInput) => void;
  onBack: () => void;
};

export const FormScreen = ({
  onSubmit,
  onBack,
}: FormScreenProps): React.JSX.Element => {
  const currentYear = new Date().getFullYear().toString();
  const [values, setValues] = useState<FieldValues>({
    squareCode: "",
    year: currentYear,
    passNumber: "1",
    pointCode: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({
    squareCode: null,
    year: null,
    passNumber: null,
    pointCode: null,
  });
  const [focusedIndex, setFocusedIndex] = useState(0);

  const updateValue = (key: FieldKey, next: string) => {
    setValues((prev) => ({ ...prev, [key]: next }));
    // Validation is silent during typing — clear visible error if any.
    if (errors[key] !== null) {
      setErrors((prev) => ({ ...prev, [key]: null }));
    }
  };

  const validateField = (key: FieldKey, value: string): string | null => {
    return validators[key](value);
  };

  const triggerBlurValidation = (key: FieldKey) => {
    const err = validateField(key, values[key]);
    setErrors((prev) => ({ ...prev, [key]: err }));
  };

  const moveFocus = (delta: number) => {
    const leavingKey = FIELD_ORDER[focusedIndex];
    if (leavingKey) triggerBlurValidation(leavingKey);
    setFocusedIndex(
      (i) => (i + delta + FIELD_ORDER.length) % FIELD_ORDER.length,
    );
  };

  const adjustNumericField = (key: NumericFieldKey, delta: number) => {
    const parsed = parseInt(values[key], 10);
    const { min, max } = NUMERIC_FIELD_BOUNDS[key];
    const base = Number.isFinite(parsed) ? parsed : min;
    const next = Math.min(max, Math.max(min, base + delta));
    updateValue(key, next.toString());
  };

  const appendDigitToNumericField = (key: NumericFieldKey, digit: string) => {
    const { max } = NUMERIC_FIELD_BOUNDS[key];
    const maxLength = max.toString().length;
    const next = (values[key] + digit).slice(-maxLength);
    updateValue(key, next);
  };

  const backspaceNumericField = (key: NumericFieldKey) => {
    updateValue(key, values[key].slice(0, -1));
  };

  const trySubmit = () => {
    const nextErrors: FieldErrors = {
      squareCode: validateField("squareCode", values.squareCode),
      year: validateField("year", values.year),
      passNumber: validateField("passNumber", values.passNumber),
      pointCode: validateField("pointCode", values.pointCode),
    };
    setErrors(nextErrors);

    const firstInvalidIndex = FIELD_ORDER.findIndex(
      (key) => nextErrors[key] !== null,
    );
    if (firstInvalidIndex !== -1) {
      setFocusedIndex(firstInvalidIndex);
      return;
    }

    onSubmit({
      squareCode: values.squareCode,
      year: parseInt(values.year, 10),
      passNumber: parseInt(values.passNumber, 10),
      pointCode: values.pointCode.toUpperCase(),
    });
  };

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow || (key.tab && key.shift)) {
      moveFocus(-1);
      return;
    }
    if (key.downArrow || key.tab) {
      moveFocus(1);
      return;
    }
    const focusedKey = FIELD_ORDER[focusedIndex];
    if (focusedKey && isNumericField(focusedKey)) {
      if (key.leftArrow) {
        adjustNumericField(focusedKey, -1);
        return;
      }
      if (key.rightArrow) {
        adjustNumericField(focusedKey, 1);
        return;
      }
      if (key.backspace || key.delete) {
        backspaceNumericField(focusedKey);
        return;
      }
      if (input >= "0" && input <= "9") {
        appendDigitToNumericField(focusedKey, input);
        return;
      }
    }
    if (key.return) {
      trySubmit();
    }
  });

  const pointNormalizationHint =
    errors.pointCode === null && LOWERCASE_POINT_REGEX.test(values.pointCode)
      ? `sera enregistré en ${values.pointCode.toUpperCase()}`
      : undefined;

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      {FIELD_ORDER.map((key, i) => (
        <TextField
          key={key}
          label={FIELD_LABELS[key]}
          value={values[key]}
          onChange={(next) => {
            updateValue(key, next);
          }}
          focus={i === focusedIndex}
          error={errors[key]}
          help={FIELD_HELPS[key]}
          normalizationHint={
            key === "pointCode" ? pointNormalizationHint : undefined
          }
          managed={isNumericField(key)}
        />
      ))}
      <Footer
        hints={[
          { key: "↑↓", label: "champ" },
          { key: "←→", label: "ajuster" },
          { key: "Entrée", label: "valider" },
          { key: "Échap", label: "retour" },
        ]}
      />
    </Box>
  );
};
