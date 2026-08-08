export type FaviconProvider = (domain: string) => string;

export const FAVICON_PROVIDERS: FaviconProvider[] = [
  (domain: string) => `https://api.iowen.cn/favicon/${domain}.png`,
  (domain: string) => `https://${domain}/favicon.ico`,
  (domain: string) => `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
];

export function getFaviconDomain(input: string) {
  if (!input) return '';

  try {
    return normalizeFaviconInput(input)?.hostname || '';
  } catch {
    return '';
  }
}

function normalizeFaviconInput(input: string) {
  try {
    return new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
}

export function getFaviconCandidates(input: string) {
  const parsedUrl = normalizeFaviconInput(input);
  const domain = parsedUrl?.hostname || '';
  if (!domain) return [];

  return Array.from(new Set([
    FAVICON_PROVIDERS[0](domain),
    `${parsedUrl?.origin || `https://${domain}`}/favicon.ico`,
    ...FAVICON_PROVIDERS.slice(2).map(provider => provider(domain)),
  ]));
}

export const getSimpleFaviconUrl = (url: string) => {
  return getFaviconCandidates(url)[0] || '';
};
