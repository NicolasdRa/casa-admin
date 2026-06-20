/** SVG `<polyline points>` for a sparkline of `values` scaled into a width×height box (y inverted). */
export function sparkline(values: number[], width = 120, height = 28): string {
  if (values.length === 0) return "";
  if (values.length === 1) return `0,${(height / 2).toFixed(1)}`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  return values
    .map(
      (v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`,
    )
    .join(" ");
}
