export const formatDuration = (seconds: number): string => {
  if (seconds < 60) {
    const rounded = Math.round(seconds);
    // A sub-second run rounds to 0: "0 secondes" on a success screen reads as
    // "nothing happened", the opposite of what the screen says.
    if (rounded === 0) return "moins d'une seconde";
    return `${rounded.toString()} seconde${rounded > 1 ? "s" : ""}`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60)
    return `${minutes.toString()} minute${minutes > 1 ? "s" : ""}`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return `${hours.toString()} h ${remMin.toString().padStart(2, "0")}`;
};
