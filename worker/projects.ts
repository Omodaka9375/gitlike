// ---------------------------------------------------------------------------
// GitLike — Projects
// Groups multiple repos under a single named project.
// ---------------------------------------------------------------------------

import type { Env } from './env.js';
import { slugify } from './repo-index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A project grouping multiple repos. */
export type Project = {
  id: string;
  name: string;
  description: string;
  repos: string[];
  owner: string;
  /** Project visibility — defaults to 'public'. */
  visibility?: 'public' | 'private';
  createdAt: string;
};

/** Summary stored in the project index. */
export type ProjectIndexEntry = {
  id: string;
  name: string;
  description: string;
  repoCount: number;
  owner: string;
  visibility?: 'public' | 'private';
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROJECT_INDEX_KEY = 'project_index';

/** KV prefix for project slug → projectId mappings. */
const PSLUG_PREFIX = 'pslug:';

/** KV key for an individual project. */
function projectKey(id: string): string {
  return `project:${id}`;
}

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------

/** Look up the projectId for a slug. */
export async function getProjectSlug(env: Env, slug: string): Promise<string | null> {
  return env.SESSIONS.get(`${PSLUG_PREFIX}${slug}`);
}

/** Store a slug → projectId mapping. */
export async function setProjectSlug(env: Env, slug: string, projectId: string): Promise<void> {
  await env.SESSIONS.put(`${PSLUG_PREFIX}${slug}`, projectId);
}

/** Delete a slug mapping. */
export async function deleteProjectSlug(env: Env, slug: string): Promise<void> {
  await env.SESSIONS.delete(`${PSLUG_PREFIX}${slug}`);
}

/** Derive the slug for a project name. */
export function projectSlug(name: string): string {
  return slugify(name);
}

// ---------------------------------------------------------------------------
// Index operations
// ---------------------------------------------------------------------------

/** Read the project index. */
export async function getProjectIndex(env: Env): Promise<ProjectIndexEntry[]> {
  const raw = await env.SESSIONS.get(PROJECT_INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ProjectIndexEntry[];
  } catch {
    return [];
  }
}

/** Add a project to the index. */
async function addToProjectIndex(env: Env, entry: ProjectIndexEntry): Promise<void> {
  const index = await getProjectIndex(env);
  const filtered = index.filter((e) => e.id !== entry.id);
  filtered.push(entry);
  await env.SESSIONS.put(PROJECT_INDEX_KEY, JSON.stringify(filtered));
}

/** Remove a project from the index. */
async function removeFromProjectIndex(env: Env, id: string): Promise<void> {
  const index = await getProjectIndex(env);
  const filtered = index.filter((e) => e.id !== id);
  await env.SESSIONS.put(PROJECT_INDEX_KEY, JSON.stringify(filtered));
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Get a project by ID. */
export async function getProject(env: Env, id: string): Promise<Project | null> {
  const raw = await env.SESSIONS.get(projectKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Project;
  } catch {
    return null;
  }
}

/** Create a project and return it. Also sets the slug mapping. */
export async function createProject(
  env: Env,
  name: string,
  description: string,
  repos: string[],
  owner: string,
  visibility: 'public' | 'private' = 'public',
): Promise<Project> {
  const id = crypto.randomUUID();
  const project: Project = {
    id,
    name,
    description,
    repos,
    owner,
    visibility,
    createdAt: new Date().toISOString(),
  };

  await env.SESSIONS.put(projectKey(id), JSON.stringify(project));
  await addToProjectIndex(env, {
    id,
    name,
    description,
    repoCount: repos.length,
    owner,
    visibility,
    createdAt: project.createdAt,
  });

  // Set slug mapping
  const slug = projectSlug(name);
  if (slug) await setProjectSlug(env, slug, id);

  return project;
}

/** Update a project. Returns the updated project or null if not found. */
export async function updateProject(
  env: Env,
  id: string,
  patch: Partial<Pick<Project, 'name' | 'description' | 'repos' | 'visibility'>>,
): Promise<Project | null> {
  const project = await getProject(env, id);
  if (!project) return null;

  const oldSlug = projectSlug(project.name);
  const updated: Project = {
    ...project,
    name: patch.name?.trim() ?? project.name,
    description: patch.description?.trim() ?? project.description,
    repos: patch.repos ?? project.repos,
    visibility: patch.visibility ?? project.visibility,
  };

  await env.SESSIONS.put(projectKey(id), JSON.stringify(updated));
  await addToProjectIndex(env, {
    id,
    name: updated.name,
    description: updated.description,
    repoCount: updated.repos.length,
    owner: updated.owner,
    visibility: updated.visibility,
    createdAt: updated.createdAt,
  });

  // Update slug if name changed
  const newSlug = projectSlug(updated.name);
  if (oldSlug !== newSlug) {
    if (oldSlug) await deleteProjectSlug(env, oldSlug);
    if (newSlug) await setProjectSlug(env, newSlug, id);
  }

  return updated;
}

/** Delete a project. Does not delete the underlying repos. */
export async function deleteProject(env: Env, id: string): Promise<void> {
  const project = await getProject(env, id);
  if (project) {
    const slug = projectSlug(project.name);
    if (slug) await deleteProjectSlug(env, slug);
  }
  await env.SESSIONS.delete(projectKey(id));
  await removeFromProjectIndex(env, id);
}

/** Populate project slug mappings from the index. Writes only missing slugs. */
export async function bootstrapProjectSlugs(env: Env): Promise<void> {
  const index = await getProjectIndex(env);
  for (const entry of index) {
    const slug = projectSlug(entry.name);
    if (!slug) continue;
    const existing = await getProjectSlug(env, slug);
    if (!existing) {
      await setProjectSlug(env, slug, entry.id);
    }
  }
}

/** Find all projects that contain a given repo groupId. */
export async function getProjectsForRepo(
  env: Env,
  repoGroupId: string,
): Promise<ProjectIndexEntry[]> {
  const index = await getProjectIndex(env);
  const results: ProjectIndexEntry[] = [];
  for (const entry of index) {
    const project = await getProject(env, entry.id);
    if (project && project.repos.includes(repoGroupId)) {
      results.push(entry);
    }
  }
  return results;
}
