import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // self-contained server bundle for the docker `prod` profile
  output: "standalone",
  // neo4j-driver is a native-ish Node package; keep it out of the bundler.
  serverExternalPackages: ["neo4j-driver"],
};

export default nextConfig;
