import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev overlay's circle sits bottom left, exactly on top of the sign button, and
  // the demo runs on the dev server. It is not worth losing the primary action to a
  // badge that says the server is running.
  devIndicators: false,
};

export default nextConfig;
