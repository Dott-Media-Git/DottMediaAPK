// Keep the channel focused on modern executive cars and substantial SUVs.
const preferredModels = /\b(?:lexus|mercedes(?:[ -]benz)?|bmw|audi|porsche|volvo|land[ -]rover|range[ -]rover|jaguar|toyota[ -]+(?:land[ -]cruiser|prado|harrier|rav[ -]?4|fortuner|highlander|camry|crown|mark[ -]?x|alphard|vellfire)|nissan[ -]+(?:x[ -]?trail|patrol|murano|fuga|skyline)|mazda[ -]+(?:cx[ -]?[5689]|6|atenza)|honda[ -]+(?:cr[ -]?v|accord)|mitsubishi[ -]+(?:pajero|outlander)|subaru[ -]+(?:forester|outback|legacy)|volkswagen[ -]+(?:tiguan|touareg|passat))\b/i;

export const isPreferredCarmarketModel = (title: string): boolean => preferredModels.test(title);

export function isEligibleCarmarketVehicle(vehicle: { title: string; summary: Record<string, string> }): boolean {
  const yearText = vehicle.summary.year || vehicle.title;
  const years = Array.from(yearText.matchAll(/\b(?:19|20)\d{2}\b/g), match => Number(match[0]));
  // Unknown or conflicting years must not silently admit an older vehicle.
  return years.length > 0 && years.every(year => year >= 2016 && year <= new Date().getFullYear() + 1)
    && isPreferredCarmarketModel(vehicle.title);
}
