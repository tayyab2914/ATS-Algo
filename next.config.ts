import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ccxt is a large CJS package with dynamic requires; keep it external so Next
  // doesn't bundle/trace it into the server chunks — it's required at runtime by
  // the Node-runtime routes that talk to exchanges (lib/exchanges/*).
  serverExternalPackages: ["ccxt"],
};

export default nextConfig;
