# Ask Rockville Homepage

This package recreates the approved Ask Rockville homepage design.

## Files

- `index.html` — page structure
- `styles.css` — responsive styling and dark mode
- `app.js` — dark mode and mobile navigation
- `assets/ask-rockville-hero.png` — approved hero artwork
- `assets/rockville-logo.png` — navbar logo

## Integration

Place this folder at the root of the project, then update these links if your
folder structure differs:

- `./pages/report.html`
- `./pages/issues.html`
- `./pages/dashboard.html`

The homepage reads issue statistics from the displayed sample values. These can
later be connected to `IssueService.js` or an API.
