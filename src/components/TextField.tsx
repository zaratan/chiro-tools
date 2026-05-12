import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export type TextFieldProps = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  focus: boolean;
  /** When non-null, displayed in red in place of the help. */
  error: string | null;
  /** Help text shown below the input when no error is visible. */
  help: string;
  /**
   * Optional normalization hint shown in dimColor when the value is valid.
   * Example: "sera enregistré en A1" when the user typed "a1".
   * Falls back to `help` when not provided.
   */
  normalizationHint?: string;
  /**
   * When true, the value is rendered as plain text instead of using
   * ink-text-input. The parent component is then responsible for all
   * keyboard handling. Used for numeric fields where left/right arrows
   * adjust the value instead of moving a cursor.
   */
  managed?: boolean;
};

/**
 * Single labeled input. Purely presentational — focus management, blur
 * detection, and validation timing are owned by the parent FormScreen.
 *
 * Layout:
 *   Label
 *     [ input ]  ✓ (when error===null && value not empty)
 *     help / error / normalization hint
 */
export const TextField = ({
  label,
  value,
  onChange,
  focus,
  error,
  help,
  normalizationHint,
  managed = false,
}: TextFieldProps): React.JSX.Element => {
  const isValid = error === null && value.length > 0;

  let footerLine: React.JSX.Element;
  if (error !== null) {
    footerLine = <Text color="red">{error}</Text>;
  } else if (isValid && normalizationHint !== undefined) {
    footerLine = <Text dimColor>{normalizationHint}</Text>;
  } else {
    footerLine = <Text dimColor>{help}</Text>;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>{label}</Text>
      <Box marginLeft={2}>
        <Text>{focus ? "│ " : "  "}</Text>
        {managed ? (
          <Text>{value}</Text>
        ) : (
          <TextInput value={value} onChange={onChange} focus={focus} />
        )}
        {isValid ? <Text color="green">{"  ✓"}</Text> : <Text>{"   "}</Text>}
      </Box>
      <Box marginLeft={2}>{footerLine}</Box>
    </Box>
  );
};
