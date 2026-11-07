import catalog from "./scratch-catalog.js";

const byId = new Map(catalog.items.map(project => [
  project.id,
  { ...project, url: `https://scratch.mit.edu/projects/${project.id}/` }
]));

export const projects = catalog.projects.map(id => byId.get(id));
export const favorites = catalog.favorites.map(id => byId.get(id));
