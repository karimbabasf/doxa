import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev overlay's circle sits bottom left, exactly on top of the sign button, and
  // the demo runs on the dev server. It is not worth losing the primary action to a
  // badge that says the server is running.
  devIndicators: false,

  // `/intake` was the text box until the screens swapped and it became `/`. Anyone
  // holding the old URL, in a bookmark or an open tab, gets a 404 that looks like the
  // server is down rather than like a route that moved.
  async redirects() {
    return [{ source: "/intake", destination: "/", permanent: false }];
  },
};

export default nextConfig;
