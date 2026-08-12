#!/usr/bin/env node
// brand-render CLI. Commands: render | validate | doctor | brands
import fs from "node:fs";
import path from "node:path";
import { loadBrand, listBrands, brandsRoot, brandRoots } from "./brand-loader.mjs";
import { validateSpec } from "./spec.mjs";
import { renderChart, listChartTypes } from "./render/index.mjs";
import { runDoctor } from "./doctor.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

function parseArgs(list) {
  const out = { _: [] };
  for (let i = 0; i < list.length; i++) {
    if (list[i].startsWith("--")) {
      const key = list[i].slice(2);
      const next = list[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(list[i]);
  }
  return out;
}

function readSpec() {
  if (args["spec-json"]) return JSON.parse(args["spec-json"]);
  if (args.spec) return JSON.parse(fs.readFileSync(args.spec, "utf8"));
  die("need --spec <file> or --spec-json '<json>'");
}

function slugify(s) {
  return String(s || "chart").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function die(msg) { console.error(msg); process.exit(1); }

try {
  if (cmd === "render") {
    const brand = loadBrand(args.brand || die("--brand required"));
    const spec = readSpec();
    const out = args.out || path.join("out", brand._meta.slug, `${slugify(spec.title)}.png`);
    const res = await renderChart({
      brand, spec, outPng: out, outPdf: args["out-pdf"], scale: Number(args.scale || 2),
    });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
  } else if (cmd === "validate") {
    const r = validateSpec(readSpec());
    console.log(r.ok ? "spec OK" : `spec INVALID:\n- ${r.errors.join("\n- ")}`);
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === "doctor") {
    const { ok, checks } = await runDoctor({ brand: args.brand });
    for (const c of checks) {
      const icon = c.status === "ok" ? "[ok]  " : c.status === "warn" ? "[warn]" : "[FAIL]";
      console.log(`${icon} ${c.name}: ${c.message}`);
    }
    process.exit(ok ? 0 : 1);
  } else if (cmd === "brands") {
    const roots = brandRoots();
    console.log(`search path: ${roots.join(path.delimiter)}`);
    console.log(`new kits are written to: ${roots[0]}`);
    const rows = listBrands();
    if (!rows.length) {
      console.log("  (no kits found - set BRAND_STUDIO_DATA to the directory holding brands/)");
    }
    for (const b of rows) {
      const from = roots.length > 1 ? `  [${b.root}]` : "";
      console.log(`  ${b.slug}${b.aliases.length ? `  (aliases: ${b.aliases.join(", ")})` : ""} - ${b.name}${from}`);
    }
  } else {
    console.log(`brand-render - deterministic on-brand chart renderer
Usage:
  node cli.mjs render      --brand <slug> (--spec <file> | --spec-json '<json>') [--out <png>] [--out-pdf <pdf>] [--scale 2]
  node cli.mjs validate    (--spec <file> | --spec-json '<json>')
  node cli.mjs doctor      [--brand <slug>]
  node cli.mjs brands
Chart types: ${listChartTypes().join(", ")}
Kit search path: ${brandRoots().join(path.delimiter)}
  (BRAND_STUDIO_DATA replaces the path; new kits land in ${brandsRoot()})`);
  }
} catch (e) {
  die(e.message);
}
