// Structured source attribution (spec 2026-07-27 §5.2).
//
// The old contract was free text: spec.footer, rendered right-aligned in
// hardcoded monospace, while assets sometimes carried a second attribution in
// a caps kicker. Tom's item 2 was exactly this: sources deserve one format,
// decided once. The spec grows a structured "source" object and this module
// owns the single rendered form. spec.footer keeps validating and is mapped
// onto source.note by applyDefaults, with a deprecation warning from the
// validator, so no existing spec breaks.

export const SOURCE_FIELDS = [
  "publication",
  "author",
  "handle",
  "work",
  "authors",
  "year",
  "url",
  "note",
];

/**
 * The one canonical attribution line. Any subset of fields; the order is
 * fixed so two specs citing the same work produce identical strings:
 *
 *   Source: Financial Times, John Burn-Murdoch (@jburnmurdoch),
 *   "Writing Code vs. Shipping Code", Demirer et al, 2026. Values digitised
 *   from the published graphic
 *
 * Returns "" when nothing usable is present, so callers can render nothing
 * rather than an orphaned "Source:" label.
 */
export function formatSource(source) {
  if (!source || typeof source !== "object") return "";
  const parts = [];
  if (source.publication) parts.push(String(source.publication));
  if (source.author) {
    parts.push(source.handle ? `${source.author} (${source.handle})` : String(source.author));
  } else if (source.handle) {
    parts.push(String(source.handle));
  }
  if (source.work) parts.push(`“${source.work}”`);
  if (source.authors) parts.push(String(source.authors));
  if (source.year) parts.push(String(source.year));

  const head = parts.length ? `Source: ${parts.join(", ")}` : "";
  const note = source.note ? String(source.note) : "";
  if (head && note) return `${head}. ${note}`;
  if (head) return head;
  if (note) return note;
  // A URL with no other field still deserves attribution rather than silence.
  return source.url ? `Source: ${source.url}` : "";
}
