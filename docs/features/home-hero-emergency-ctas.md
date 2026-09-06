# Home hero emergency telephone actions

The React Home hero phone mockup presents Police or Fire Emergency — Call 911
(`tel:911`) and Water/Sewer Emergency — Call 240-314-8567 (`tel:2403148567`).
Both are native telephone links with descriptive accessible labels, Bootstrap
Icons for the emergency type, and a trailing phone icon. They do not enter intake.
The bold emergency titles reuse the Home cards' `bi-shield-fill-exclamation` and
`bi-droplet-fill` classes, with smaller secondary call numbers below each title.
The cards and hero share `--home-emergency-icon-color` and
`--home-water-icon-color`, preserving the cards' exact colors in each theme.
News Alerts uses the same bold weight as the emergency titles.

The original phone menu is part of the hero raster image. HTML rows cover
the old Track Your Request, Request a Service, and News & Updates rows. The last
row now displays News Alerts and opens `https://www.rockvillemd.gov/news/?page=1`
in a new tab with `rel="noopener noreferrer"` and an accessible label.
A transparent React Router Link makes the existing blue Report an Issue artwork
clickable, navigating internally to `/report`. The separate Report a Concern CTA
is unchanged. Positions and sizes scale with the image, retaining its light phone
screen in both themes. The image, branding, and other Home content remain unchanged.
If the hero artwork changes, recheck the overlay alignment. Existing full-size
emergency quick actions below the hero remain available on small screens.

No catalog, persistence, Answer model, API, or integration changes are involved.
Telephone handling depends on the user's device; no configuration is required.
