import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `/intake` was the text box until the screens swapped and it became `/`. Anyone
  // holding the old URL, in a bookmark or an open tab, gets a 404 that looks like the
  // server is down rather than like a route that moved.
  async redirects() {
    return [{ source: "/intake", destination: "/", permanent: false }];
  },
};

export default nextConfig;
