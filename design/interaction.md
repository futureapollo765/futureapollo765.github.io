# Interaction notes

The starting point was a working monochrome portfolio: an orbital assembly, a belt of project names, two favorites rows, and a spatial map. Exploring it revealed a mismatch between what looked interactive and what a gesture actually did. Every title in the belt opened the same map; dragging a favorites row barely changed its position; trackpad pinch did not zoom the map; a full-screen wipe interrupted a thumbnail that was already animating into detail.

| Live reference | Interaction observed | Decision for this site |
| --- | --- | --- |
| [MECHA](https://mecha-xyz.webflow.io/) | The wireframe stays in view and shrinks as scrolling brings the first investment into position. | Keep the assembly and the project covers in the same stage. Let actual work take the visual lead as the introduction ends. |
| [GRIDS S03](https://grids03.obys.agency/) | Scrolling separates the title and reveals imagery on a persistent grid. | Separate the introductory lettering as the cover appears; keep the index and typographic alignment stable. |
| [FORMAT](https://format.obys.agency/) | A broad composition crosses the masthead while text remains aligned in its columns. | Reveal neighboring covers like overlapping sheets. Preserve the original Scratch artwork and aspect ratio. |
| [ESR Bespoke](https://www.esrbespoke.au/) | Scrolling moves from a dark film to a light reading surface; the compact menu button stays in place as its panel opens. | Make the project index a persistent control within the home stage, with a clear selected state and a separate link to open the selected work. |
| [Room & Pillar](https://www.roomandpillar.com/) | The small navigation remains reachable after leaving the hero; opening it grows the menu from the same location. | Keep map controls anchored and let a project expand from the tile the visitor chose. Restore that exact map pose on return. |

The index reads from the existing catalog and disappears if it is empty. Favorites still move while hovered, but only the lane being held stops. Direction-sensitive touch gestures leave ordinary vertical page scrolling to the browser. Disabling automatic motion keeps the index, map, orbital assembly, and favorites usable manually.
