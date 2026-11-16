// Site-wide settings. Swap the placeholder URLs before launch.
export const config = {
  siteName: "OpenPresets",
  domain: "openpresets.com",

  // Local sample data for now. Later: the Google Sheet "Publish to web" CSV URL
  // for the Presets tab, e.g.
  // https://docs.google.com/spreadsheets/d/e/<id>/pub?gid=<gid>&single=true&output=csv
  presetsCsvUrl: "presets.csv",

  // TODO: replace with real links
  githubUrl: "https://github.com/ganeshsekhar/openpresets",
  donateUrl: "https://buymeacoffee.com/openpresets",
  requestFormUrl: "https://forms.gle/REPLACE_ME",

  // Lightroom groups presets by this name after import.
  presetGroup: "OpenPresets",
};
