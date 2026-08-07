// Small text helpers shared by layouts.
export function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Convert ==text== into the brand highlighter, for a PLAIN-TEXT value. Everything
// else is escaped, so this is only safe on strings that are not already markup.
export function inline(s = "") {
  return escapeHtml(s).replace(/==(.+?)==/g, "<mark>$1</mark>");
}

// Convert ==text== into the brand highlighter inside AUTHORED HTML. No escaping:
// the asset body is markup, and escaping it would print the tags instead of
// rendering them. Bounded to a single line and to runs without an inner `=` so a
// stray pair of equals signs elsewhere in the body cannot swallow the document.
export function marks(s = "") {
  return String(s).replace(/==([^=\n]+?)==/g, "<mark>$1</mark>");
}
