import { Box, Text } from "ink";
import { renderBar } from "../format/progress.js";
import { Footer } from "./Footer.js";

export type ProgressPanelProps = {
  cwd: string;
  title: string;
  counterLines: readonly string[];
  percent: number;
  statsLine: string;
  reassuranceLines: readonly string[];
};

export const ProgressPanel = ({
  cwd,
  title,
  counterLines,
  percent,
  statsLine,
  reassuranceLines,
}: ProgressPanelProps): React.JSX.Element => (
  <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
    <Text>📁 {cwd}</Text>
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
