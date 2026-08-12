// Chart-spec schema + validator: the extract<->render contract (spec §6).
// The validator is the mechanical half of the data-integrity hard gate; the
// judgement half (render matches SOURCE) is Claude's vision check in the loop.
//
// Returns { ok, errors, warnings }: errors block the render, warnings surface
// deprecations and soft mistakes without breaking existing specs.

import { SOURCE_FIELDS } from "./render/charts/source.mjs";

export const SPEC_TYPES = ["area", "line", "bar", "pie"];

function pointY(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) return v.y;
  if (Array.isArray(v)) return v[1];
  return v;
}
function pointX(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) return v.x;
  if (Array.isArray(v)) return v[0];
  return null;
}

export function validateSpec(spec) {
  const errors = [];
  const warnings = [];
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return { ok: false, errors: ["spec must be an object"], warnings };
  }
  if (!SPEC_TYPES.includes(spec.type)) {
    errors.push(`type must be one of ${SPEC_TYPES.join(", ")} (got "${spec.type}")`);
  }

  if (!Array.isArray(spec.series) || spec.series.length === 0) {
    errors.push("series must be a non-empty array");
  } else {
    if (["area", "line", "pie"].includes(spec.type) && spec.series.length !== 1) {
      errors.push(`${spec.type} charts take exactly 1 series in v1 (got ${spec.series.length})`);
    }
    spec.series.forEach((s, i) => {
      if (!Array.isArray(s.values) || s.values.length === 0) {
        errors.push(`series[${i}].values must be a non-empty array`);
        return;
      }
      s.values.forEach((v, j) => {
        const y = pointY(v);
        if (y == null || Number.isNaN(+y)) errors.push(`series[${i}].values[${j}]: y is null/NaN`);
        if (spec.type === "pie") {
          if (!(+y > 0)) errors.push(`series[${i}].values[${j}]: pie values must be > 0`);
          const label = pointX(v);
          if (label == null || String(label).trim() === "") {
            errors.push(`series[${i}].values[${j}]: pie slices need a label (x)`);
          }
        }
      });
    });
    if (spec.type === "bar" && spec.series.length > 1) {
      const len = spec.series[0].values.length;
      if (spec.series.some((s) => Array.isArray(s.values) && s.values.length !== len)) {
        errors.push("bar series must all have the same number of categories");
      }
    }
  }

  if (spec.stacked && spec.type !== "bar") errors.push("stacked is only valid for bar charts");

  // emphasis names the ONE category or slice that carries the point. It must
  // match a label that exists, or the chart silently emphasises nothing and the
  // author never finds out.
  if (spec.emphasis != null) {
    if (!["bar", "pie"].includes(spec.type)) {
      errors.push("emphasis is only valid for bar and pie charts");
    } else if (Array.isArray(spec.series) && Array.isArray(spec.series[0]?.values)) {
      const labels = spec.series[0].values.map((v) => String(pointX(v)));
      if (!labels.includes(String(spec.emphasis))) {
        errors.push(
          `emphasis "${spec.emphasis}" matches no category (have: ${labels.join(", ")})`,
        );
      }
    }
  }

  // ordered marks slices that run in a sequence, which selects a blend instead
  // of the brand's categorical colours (lib/render/charts/pie.mjs).
  if (spec.ordered != null && typeof spec.ordered !== "boolean") {
    errors.push(`ordered must be true or false (got "${spec.ordered}")`);
  }
  if (spec.ordered === true && spec.type !== "pie") {
    errors.push("ordered is only valid for pie charts in v1");
  }

  if (spec.legendValue != null && !["both", "value", "percent"].includes(spec.legendValue)) {
    errors.push(`legendValue must be one of both, value, percent (got "${spec.legendValue}")`);
  }

  const prov = spec.provenance;
  if (prov && Array.isArray(prov.uncertain) && prov.uncertain.length > 0 && prov.confirmedByUser !== true) {
    errors.push(
      `provenance.uncertain is non-empty (${prov.uncertain.join(", ")}) and confirmedByUser is not true` +
        " - confirm the extraction before rendering",
    );
  }

  if (spec.size && (!Number.isFinite(spec.size.width) || !Number.isFinite(spec.size.height))) {
    errors.push("size must have numeric width and height");
  }

  // Structured source (spec §5.2). Attribution has one shape and renders once;
  // free-text footer keeps working but is on its way out.
  if (spec.source != null) {
    if (typeof spec.source !== "object" || Array.isArray(spec.source)) {
      errors.push("source must be an object (see SOURCE_FIELDS)");
    } else {
      const unknown = Object.keys(spec.source).filter((k) => !SOURCE_FIELDS.includes(k));
      if (unknown.length) {
        warnings.push(
          `source has unknown field(s): ${unknown.join(", ")} (known: ${SOURCE_FIELDS.join(", ")})`,
        );
      }
    }
  }
  if (spec.footer != null) {
    warnings.push(
      spec.source && spec.source.note != null
        ? "spec.footer is deprecated and IGNORED here because source.note is set - drop footer"
        : "spec.footer is deprecated: it is mapped onto source.note. Use the structured source block",
    );
  }

  // Annotations (spec §5.4) are chart-type-agnostic but their anchors are not:
  // each type names its target differently, and a target that does not exist
  // must fail loudly or the arrow points at nothing and nobody finds out.
  if (spec.annotations != null) {
    if (!Array.isArray(spec.annotations)) {
      errors.push("annotations must be an array");
    } else if (Array.isArray(spec.series) && Array.isArray(spec.series[0]?.values)) {
      const labels = spec.series[0].values.map((v) => String(pointX(v)));
      const seriesNames = spec.series.map((s, i) => s.name || `series ${i + 1}`);
      spec.annotations.forEach((a, i) => {
        if (!a || typeof a !== "object") {
          errors.push(`annotations[${i}] must be an object`);
          return;
        }
        if (a.text == null || String(a.text).trim() === "") {
          errors.push(`annotations[${i}]: text is required`);
        }
        if (spec.type === "bar") {
          if (a.category == null) {
            errors.push(`annotations[${i}]: bar annotations anchor by { category, series? }`);
          } else if (!labels.includes(String(a.category))) {
            errors.push(
              `annotations[${i}]: category "${a.category}" matches no category (have: ${labels.join(", ")})`,
            );
          }
          if (a.series != null && !seriesNames.includes(String(a.series))) {
            errors.push(
              `annotations[${i}]: series "${a.series}" matches no series (have: ${seriesNames.join(", ")})`,
            );
          }
        } else if (spec.type === "pie") {
          if (a.slice == null) {
            errors.push(`annotations[${i}]: pie annotations anchor by { slice }`);
          } else if (!labels.includes(String(a.slice))) {
            errors.push(
              `annotations[${i}]: slice "${a.slice}" matches no slice (have: ${labels.join(", ")})`,
            );
          }
        } else {
          // area/line anchor in data units.
          if (a.x == null || a.y == null || Number.isNaN(+a.y)) {
            errors.push(`annotations[${i}]: ${spec.type} annotations anchor by { x, y } in data units`);
          }
        }
      });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function applyDefaults(spec, brand) {
  const out = structuredClone(spec);
  if (!out.size && brand && brand.chart && brand.chart.defaultSize) {
    out.size = structuredClone(brand.chart.defaultSize);
  }
  // Legacy footer folds into the structured source block (spec §5.2), and the
  // footer key is removed so exactly one code path can ever draw attribution.
  if (out.footer != null && String(out.footer).trim() !== "") {
    out.source = out.source || {};
    if (out.source.note == null) out.source.note = String(out.footer);
  }
  delete out.footer;
  return out;
}
