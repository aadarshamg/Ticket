import type { MetadataRoute } from 'next';

// Nothing here is for search engines: pass links are secrets and the rest needs a login.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', disallow: '/' }] };
}
