/**
 * Açılır-kapanır bilgilendirme blokları — (i) ikonu ile native <details>.
 */
export function renderOpsInfoDisclosure({
  id = '',
  title,
  paragraphs = [],
  items = []
} = {}) {
  if (!title) return '';

  const bodyParts = [];
  for (const paragraph of paragraphs) {
    if (paragraph) bodyParts.push(`<p>${paragraph}</p>`);
  }
  if (items.length) {
    bodyParts.push(`<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`);
  }

  const idAttr = id ? ` id="${id}"` : '';
  return `<details class="ops-info-disclosure"${idAttr}>
    <summary class="ops-info-disclosure-summary">
      <span class="ops-info-icon" aria-hidden="true">i</span>
      <span class="ops-info-disclosure-title">${title}</span>
    </summary>
    <div class="ops-info-disclosure-body">${bodyParts.join('')}</div>
  </details>`;
}
