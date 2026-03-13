const ROOT_DOMAINS = ["sheilasystem.com.br"];

type ResolveSlugOptions = {
  hostname?: string;
  search?: string;
  fallback?: string;
};

function isLocalHost(hostname: string) {
  if (!hostname) return true;
  if (hostname === "localhost") return true;
  if (hostname === "127.0.0.1") return true;
  if (hostname === "0.0.0.0") return true;
  return false;
}

function extractSubdomainSlug(hostname: string) {
  const host = hostname.toLowerCase();

  if (isLocalHost(host)) return null;

  for (const rootDomain of ROOT_DOMAINS) {
    if (host === rootDomain || host === `www.${rootDomain}`) return null;
    if (host.endsWith(`.${rootDomain}`)) {
      const sub = host.slice(0, host.length - (rootDomain.length + 1));
      if (!sub || sub.includes(".")) return null;
      if (sub === "www") return null;
      return sub;
    }
  }

  return null;
}

export function resolveEmpresaSlug({
  hostname = typeof window !== "undefined" ? window.location.hostname : "",
  search = typeof window !== "undefined" ? window.location.search : "",
  fallback = "nando",
}: ResolveSlugOptions = {}) {
  const bySubdomain = extractSubdomainSlug(hostname);
  if (bySubdomain) return bySubdomain;

  const params = new URLSearchParams(search || "");
  const byQuery = (params.get("empresa") || "").trim();
  if (byQuery) return byQuery;

  return fallback;
}

export function getEmpresaSlug(fallback = "nando") {
  return resolveEmpresaSlug({ fallback });
}
