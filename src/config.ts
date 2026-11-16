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

  // Copyright / DMCA contact. Set an email to show it; until then the site
  // links to the GitHub "Copyright / DMCA" issue form.
  contactEmail: "",
  legalIssueUrl:
    "https://github.com/ganeshsekhar/openpresets/issues/new?template=copyright-dmca.yml",
  creditsUrl: "https://github.com/ganeshsekhar/openpresets/blob/main/CREDITS.md",

  // Lightroom groups presets by this name after import.
  presetGroup: "OpenPresets",
};
