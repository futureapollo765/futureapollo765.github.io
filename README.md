# FutureApollo765

A personal showcase built with static HTML, CSS, and JavaScript. Run `python3 -m http.server 8000` in the repository and open <http://localhost:8000/>.

## Experience

- **Home** pairs the public handle with an original orbital assembly. Scroll to change the composition, drag to rotate the object, or focus it and use the arrow keys. The header motion button remembers a visitor’s preference.
- **Selected work** shows public Scratch favorites in a moving horizontal reel. Hover or focus to inspect a project, use the controls to browse, or open the original on Scratch.
- **Projects** is a repeating two-dimensional map of shared projects. Pan to explore, choose a project by name, and open its player on demand. A link such as `#projects/1406787990` goes directly to one work.
- **Intro** plays a shortened version of the supplied recording once per tab on a fresh home visit. The vector mark has exact four-fold rotational symmetry. Reduced-motion preferences bypass the intro and automatic movement.

## Scratch updates

`python3 tools/refresh_scratch.py` fetches every page of the account’s shared projects and public favorites. It caches cover images locally and preserves curated running-stage captures. The project list and the favorites list follow Scratch’s ordering. The map uses the official Scratch player or TurboWarp for projects that recommend it. [Scratch profile](https://scratch.mit.edu/users/FutureApollo765/) · [TurboWarp embed documentation](https://docs.turbowarp.org/embedding)

The **Refresh Scratch catalog** workflow runs daily at **08:17 UTC** and can be run manually in GitHub Actions. It writes a commit when the catalog or covers change. Fetching takes place in the workflow because Scratch’s API restricts cross-origin browser requests from a Pages site. A failed fetch leaves the last successful catalog on `main`. [Workflow](.github/workflows/refresh-scratch.yml)

## GitHub Pages

The repository name `futureapollo.github.io` under `futureapollo765` gives this project the Pages address <https://futureapollo765.github.io/futureapollo.github.io/> once enabled. Relative asset URLs and hash routes support the project subpath and direct links.

To publish, choose **Settings → Pages → Deploy from a branch**, then **main** and **/ (root)**. The catalog workflow explicitly requests a Pages rebuild when its commit is newer than the published branch build. A private personal repository needs GitHub Pro or another eligible plan. A root site at `futureapollo765.github.io` requires a repository of that exact name. [Pages requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) · [Publishing settings](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Orbital artwork

The editable Blender scene generator is in `design/orbit/render.py`. From the repository root, run the following with Blender 5.x, `cwebp`, and FFmpeg with libx264 available. The shipped assets are ready to serve.

```sh
blender -b --factory-startup --python-exit-code 1 -P design/orbit/render.py -- --output assets/orbit --film
```

Omit `--film` to regenerate the poster and individual rotation frames.
