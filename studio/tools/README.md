# Studio tools

## filmgrab-console.js

Saves 5 random stills from one film-grab.com film, plus a film-info file, as local colour references.

**Run it (Chrome)**

1. Copy the script: `pbcopy < studio/tools/filmgrab-console.js`
2. Open one film page you picked on film-grab.com (not the homepage).
3. Open the console (Cmd+Option+J). First time only: type `allow pasting` and press Enter.
4. Paste and press Enter. Allow multiple downloads if Chrome asks.
5. About 18 seconds later your Downloads folder has `<film>_NN.jpg` × 5 and `<film>.json`.
   Move them to `~/OpenPresets-data/refs/film-grab/<film>/`.

Stop early: `window.__opStop = true` in the console.

**Rules** (see `docs/legal-protocol.md` → Approved sources)

- Picked films only, one film per run. Never loop over the site.
- Keep the 3.5-second pace between images.
- Stills are local references only: never publish, share or commit them.
  Film titles and credits never go into preset names or site copy.
