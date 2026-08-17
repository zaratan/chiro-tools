import { Box, Text } from "ink";
import { renderBar } from "../format/progress.js";
import { Footer } from "./Footer.js";
import { fitPath } from "../format/path.js";

export type ProgressPanelProps = {
  cwd: string;
  title: string;
  counterLines: readonly string[];
  percent: number;
  statsLine: string;
  reassuranceLines: readonly string[];
  /** Rendered in yellow between the counter lines and the bar, e.g. the
   * offsite flow's "connexion ralentie" warning. Optional — the three
   * pre-existing callers never pass it, and its absence changes nothing
   * about their output. */
  noticeLine?: string;
};

export const ProgressPanel = ({
  cwd,
  title,
  counterLines,
  percent,
  statsLine,
  reassuranceLines,
  noticeLine,
}: ProgressPanelProps): React.JSX.Element => (
  <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
    <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
    <Box marginTop={1}>
      <Text>{title}</Text>
    </Box>
    {counterLines.length > 0 ? (
      <Box marginTop={1} flexDirection="column">
        {counterLines.map((line, index) => (
          <Text key={index}>{line}</Text>
        ))}
      </Box>
    ) : null}
    {noticeLine !== undefined ? (
      <Box marginTop={1}>
        <Text color="yellow">{noticeLine}</Text>
      </Box>
    ) : null}
    <Box marginTop={1} flexDirection="column">
      <Text>{`  ${renderBar(percent)}  ${percent.toString()} %`}</Text>
      <Text dimColor>{`  ${statsLine}`}</Text>
    </Box>
    <Box marginTop={1} flexDirection="column">
      {reassuranceLines.map((line, index) => (
        <Text key={index} dimColor>
          {line}
        </Text>
      ))}
    </Box>
    <Footer hints={[]} />
  </Box>
);
