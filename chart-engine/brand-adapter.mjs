// Map the plugin's brand.json shape (colors{} + flat fonts + houseStyle) onto the
// shape the ported render engine consumes (palette{} + role-nested fonts + chart{}).
// One brand kit drives both engines; only the read-shape differs.

export function adaptProfile(profile = {}, dir) {
  const colors = profile.colors || {};
  const fonts = profile.fonts || {};
  const filesFor = (family) =>
    (fonts.files || [])
      .filter((f) => f.family === family)
      .map((f) => ({ file: f.file, weight: f.weight || 400, style: f.style || "normal" }));

  return {
    palette: { ...colors },
    fonts: {
      headline: { family: fonts.headlineFamily || "system-ui", files: filesFor(fonts.headlineFamily) },
      body: { family: fonts.bodyFamily || fonts.headlineFamily || "system-ui", files: filesFor(fonts.bodyFamily) },
    },
    chart: profile.chart || {},
    logo: profile.logo,                 // pass through so charts/util.mjs readLogoIcon() can
                                        // use brand.logo.icon when the kit declares an SVG icon
    aliases: profile.aliases || [],
    name: profile.name || profile.slug,
    _meta: { slug: profile.slug, dir },
  };
}
