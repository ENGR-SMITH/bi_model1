import { clerkClient } from "@clerk/express";

// ---------------------------------------------------------------------------
// Clerk id → display-name resolution for the Creator Den activity feed. The
// Author Den stores contributor names at write time; video events only carry
// actor ids, so names are resolved here at read time. An in-memory TTL cache
// keeps per-request Clerk lookups to a minimum, and any failure falls back to
// short ids so the feed never breaks because name resolution is down.
// ---------------------------------------------------------------------------

const cache = new Map<string, { name: string | null; at: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

interface ClerkUserLike {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  emailAddresses?: Array<{ emailAddress: string }>;
}

function displayName(user: ClerkUserLike): string | null {
  const full = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  if (full) return full;
  if (user.username) return user.username;
  const email = user.emailAddresses?.[0]?.emailAddress;
  if (email) return email.split("@")[0] ?? null;
  return null;
}

/** Clears the name cache (tests). */
export function clearUserNameCache(): void {
  cache.clear();
}

/**
 * Resolves Clerk user ids to display names. Unresolvable ids (or a Clerk
 * outage) yield no entry — callers fall back to the raw short id.
 */
export async function resolveUserNames(
  userIds: string[],
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  const missing: string[] = [];
  const now = Date.now();

  for (const id of userIds) {
    const hit = cache.get(id);
    if (hit && now - hit.at < CACHE_TTL_MS) {
      result[id] = hit.name;
    } else {
      missing.push(id);
    }
  }

  if (missing.length > 0) {
    try {
      const list = await clerkClient.users.getUserList({ userId: missing });
      for (const user of list.data) {
        const name = displayName(user as ClerkUserLike);
        result[user.id] = name;
        cache.set(user.id, { name, at: now });
      }
    } catch {
      // Name resolution is best-effort — the feed still works on short ids.
    }
  }

  return result;
}
