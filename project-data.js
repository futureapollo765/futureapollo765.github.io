import catalog from "./scratch-catalog.js";

const byId = new Map(catalog.items.map(project => [
  project.id,
  { ...project, url: `https://scratch.mit.edu/projects/${project.id}/` }
]));

export const projects = catalog.projects.map(id => byId.get(id));
export const favorites = catalog.favorites.map(id => byId.get(id));

// Detail/player routes can include favorites without adding other authors'
// work to the studio's own map, index, picker, or timeline.
export function findProject(id) {
  const project = byId.get(Number(id));
  return project && String(project.id) === String(id) ? project : undefined;
}
