#!/usr/bin/env bun
import { Box, render, Text, useApp, useInput } from "ink";
import { readdirSync } from "node:fs";
import { useState } from "react";

function App() {
  const { exit } = useApp();
  const [tick, setTick] = useState(0);
  const entries = readdirSync(".");

  useInput((input, key) => {
    if (input === "q" || key.escape) exit();
    if (input === " ") setTick((t) => t + 1);
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">chiro — Hello Vigie-Chiro</Text>
      <Text dimColor>{entries.length} entrée(s) dans le dossier courant</Text>
      <Text>Compteur (espace pour incrémenter) : {tick}</Text>
      <Text dimColor>q ou Échap pour quitter</Text>
    </Box>
  );
}

render(<App />);
