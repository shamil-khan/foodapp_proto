export function formatPrice(value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(numeric)) {
    return '£0.00';
  }
  return `£${numeric.toFixed(2)}`;
}
