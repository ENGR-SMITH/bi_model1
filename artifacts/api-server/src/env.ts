// Loads a local .env file (repo root or api-server cwd) as the very first
// module so database, Clerk, admin, and provider credentials are available to
// every downstream import. Best-effort: missing files or older Node runtimes
// are ignored and real environment variables win.
try {
  const loadEnvFile = (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile;
  if (typeof loadEnvFile === "function") {
    const candidates = [".env", "../.env", "../../.env"];
    for (const candidate of candidates) {
      try {
        loadEnvFile(candidate);
        break;
      } catch {
        // try the next candidate
      }
    }
  }
} catch {
  // env loading is best-effort
}
