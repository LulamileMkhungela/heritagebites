/**
 * Asset paths that survive a sub-path deployment.
 *
 * Images are authored as root-relative paths ("/img/mogodu.jpg"). That is right
 * when Express serves the site from the domain root, and wrong on GitHub Pages,
 * where the same site lives at /heritagebites/ and every one of those images
 * would 404. Everything that renders or receives a path from the catalogue goes
 * through here, so the base is applied once, in one place.
 */
import { BASE_URL } from './api';

const ROOT = BASE_URL.replace(/\/$/, '');

/** Prefix a root-relative path with the site base. Absolute and data URLs pass through. */
export function asset(path: string): string {
  if (!path || !path.startsWith('/')) return path;
  return `${ROOT}${path}`;
}

/**
 * Walk the catalogue and rewrite its image paths.
 *
 * Only strings beginning "/img/" are touched: descriptions and policies are
 * left exactly as the owner approved them.
 */
export function withAssetBase<T>(value: T): T {
  if (typeof value === 'string') return (value.startsWith('/img/') ? `${ROOT}${value}` : value) as unknown as T;
  if (Array.isArray(value)) return value.map((entry) => withAssetBase(entry)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) out[key] = withAssetBase(entry);
    return out as T;
  }
  return value;
}
