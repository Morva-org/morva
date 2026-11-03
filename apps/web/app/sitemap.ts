import type { MetadataRoute } from "next";
import { SITE_URL } from "./site-config";

// One page for now. Add /pay and dashboard routes here only if they should be indexed (they shouldn't).
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/`, lastModified: new Date(), changeFrequency: "weekly", priority: 1 }];
}
