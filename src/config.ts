const FALLBACK_API_URL = 'https://scaylit.klopfensteincharly2.workers.dev';

function isLocalHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::' ||
    host === '::1' ||
    /^f[cd][0-9a-f]*:/i.test(host) ||
    /^fe[89ab][0-9a-f]*:/i.test(host)
  ) {
    return true;
  }

  const ipv4 = host.split('.').map(Number);
  if (ipv4.length !== 4 || ipv4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const first = ipv4[0]!;
  const second = ipv4[1]!;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function normalizeApiBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("L’URL du Worker est obligatoire.");

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw new Error("L’URL du Worker n’est pas valide.");
  }

  if (url.protocol !== 'https:') {
    throw new Error("L’URL du Worker doit commencer par https://.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("L’URL du Worker ne doit contenir ni identifiants, ni paramètres, ni ancre.");
  }
  if (isLocalHostname(url.hostname)) {
    throw new Error("L’URL du Worker doit être publique et ne peut pas pointer vers le réseau local.");
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function configuredDefaultApiBaseUrl() {
  try {
    return normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_URL?.trim() || FALLBACK_API_URL);
  } catch {
    return FALLBACK_API_URL;
  }
}

export const DEFAULT_API_BASE_URL = configuredDefaultApiBaseUrl();

let activeApiBaseUrl = DEFAULT_API_BASE_URL;

export const getApiBaseUrl = () => activeApiBaseUrl;

export function setApiBaseUrl(value: string) {
  activeApiBaseUrl = normalizeApiBaseUrl(value);
  return activeApiBaseUrl;
}

export const apiUrl = (path: string) =>
  `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
