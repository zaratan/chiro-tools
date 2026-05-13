export const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds).toString()} secondes`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60)
    return `${minutes.toString()} minute${minutes > 1 ? "s" : ""}`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return `${hours.toString()} h ${remMin.toString().padStart(2, "0")}`;
};
