// Browser-ready implementation; no TypeScript build step is required.
export function detectLanguage(text) {
  const counts = { hi: 0, bn: 0, ta: 0, en: 0 };
  for (const char of String(text || "")) {
    if (/[\u0900-\u097f]/u.test(char)) counts.hi++;
    else if (/[\u0980-\u09ff]/u.test(char)) counts.bn++;
    else if (/[\u0b80-\u0bff]/u.test(char)) counts.ta++;
    else if (/[a-z]/i.test(char)) counts.en++;
  }
  return Object.keys(counts).reduce((best, lang) =>
    counts[lang] > counts[best] ? lang : best, "en");
}
