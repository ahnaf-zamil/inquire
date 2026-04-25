export function normalizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);

    let hostname = parsed.hostname.toLowerCase();
    // Don't strip www - some sites serve different content based on subdomain
    parsed.hostname = hostname;

    if (parsed.port === '80' || parsed.port === '443') {
      parsed.port = '';
    }

    if (parsed.pathname.endsWith('/') && parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    if (parsed.search) {
      const params = new URLSearchParams(parsed.search);
      params.sort();
      parsed.search = params.toString();
    }

    parsed.hash = '';

    return parsed.toString();
  } catch {
    return null;
  }
}

export function getDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    let hostname = parsed.hostname.toLowerCase();
    return hostname;
  } catch {
    return null;
  }
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    const allowedProtocols = ['http:', 'https:'];
    if (!allowedProtocols.includes(parsed.protocol)) {
      return false;
    }
    
    if (isPrivateIP(parsed.hostname)) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

function isPrivateIP(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true;
  }
  
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipv4Pattern);
  
  if (match) {
    const [, a, b] = match;
    const first = parseInt(a, 10);
    const second = parseInt(b, 10);
    
    if (first === 10) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 127) return true;
    if (first === 0) return true;
    if (first >= 224) return true;
  }
  
  return false;
}

export function resolveUrl(base: string, relative: string): string | null {
  try {
    const resolved = new URL(relative, base);
    return resolved.toString();
  } catch {
    return null;
  }
}