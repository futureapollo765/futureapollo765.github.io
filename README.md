# FutureApollo765

A personal showcase built with static HTML, CSS, and JavaScript. Run `python3 -m http.server 8000` in the repository and open <http://localhost:8000/>.

## Experience

- **Home** pairs the public handle with an original orbital assembly. Drag it to turn, release to let it settle, or grab it again to stop. Keyboard arrows turn it while it has focus. The header motion control remembers a visitor's preference.
- **Project index** uses the six latest projects in the synced catalog. Scroll to blend the assembly into the first cover. From there the index moves in reading stages: scrolling starts a full title change, with one wipe for each rendered line. Sustained input continues through adjacent stages without requiring a pause between gestures. The outgoing title clears before the next appears. A deliberate click can jump straight to any numbered position. Hover to preview, tap to select, swipe across the cover to change projects, or use the arrow keys on the index and Enter to open. The cover opens its project; browser Back restores the selected cover and scroll position.
- **Project studies** pairs three real running-stage captures with short introductions. Scroll to raise and fade one note at a time, with a stationary interval for reading and a longer, separately sized transition interval. The cover stays in place and wipes horizontally. The numbered controls also work with a keyboard or reduced motion.
- **Timeline** uses public Scratch sharing dates. Vertical progress moves a horizontal strip of releases; year buttons and a dated project picker provide direct access. Short screens and reduced motion keep the strip independently scrollable.
- **Selected work** shows public Scratch favorites in two continuously moving rows. The upper row fits three cards. Hover for details, drag or swipe either row to scrub, and release to resume its pace. Keyboard arrows browse real links; Enter opens the focused favorite on Scratch.
- **Projects** is a repeating two-dimensional map of shared projects. Drag to move the map twice the pointer distance; it accelerates and settles at that exact destination. Scroll to pan, pinch to zoom around the pointer or your fingers, and use the title picker for a specific project. Arrows move between nearby works; Enter opens the current one. On touch screens, a tap opens a tile and the directional controls are available from the map toolbar.
- **Intro and transitions** use the supplied recording and the corrected vector mark with four-fold rotational symmetry. A fresh home visit plays the clip once per tab. The mark bridges page switches; when the same thumbnail exists in both views, it expands and returns in place. Click outside the detail preview or press Escape to minimize it. The map pose or originating home section is restored. Ordinary vertical wheel scrolling on Home accelerates and eases to rest; touch, zoom, nested controls, and reduced motion keep their native behavior. Reduced motion skips these effects while preserving direct manipulation and navigation.

See the [interaction design notes](design/interaction.md) for the live references and behavior decisions.

## Scratch updates

`python3 tools/refresh_scratch.py` fetches every page of the account’s shared projects and public favorites. It records each public sharing date, caches cover images locally and preserves curated running-stage captures. The project list and the favorites list follow Scratch’s ordering. The map uses the official Scratch player or TurboWarp for projects that recommend it. [Scratch profile](https://scratch.mit.edu/users/FutureApollo765/) · [TurboWarp embed documentation](https://docs.turbowarp.org/embedding)

The **Refresh Scratch catalog** workflow runs daily at **08:17 UTC** and can be run manually in GitHub Actions. It writes a commit when the catalog or covers change. Fetching takes place in the workflow because Scratch’s API restricts cross-origin browser requests from a Pages site. A failed fetch leaves the last successful catalog on `main`. [Workflow](.github/workflows/refresh-scratch.yml)

## GitHub Pages

The repository name `futureapollo.github.io` under `futureapollo765` gives this project the Pages address <https://futureapollo765.github.io/futureapollo.github.io/> once enabled. Relative asset URLs and hash routes support the project subpath and direct links.

To publish, choose **Settings → Pages → Deploy from a branch**, then **main** and **/ (root)**. The catalog workflow explicitly requests a Pages rebuild when its commit is newer than the published branch build. A private personal repository needs GitHub Pro or another eligible plan. A root site at `futureapollo765.github.io` requires a repository of that exact name. [Pages requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) · [Publishing settings](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Orbital artwork

The orbital assembly is rendered from its mesh at the display refresh rate, using studio views for its surface reflections. The poster and angle stills remain available for reduced motion, data saving, or unavailable WebGL. The shipped assets are ready to serve. To rebuild the artwork, use Blender 5.x with `cwebp` and Python with Pillow:

```sh
blender -b --factory-startup --python-exit-code 1 -P design/orbit/render.py -- --output assets/orbit
blender -b --factory-startup --python-exit-code 1 -P design/orbit/render.py -- --output assets/orbit --mesh
python3 design/orbit/build_atlas.py assets/orbit
```
