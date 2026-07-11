"use client";

import { Suspense } from "react";
import { RuntimeEndpointDetailPage } from "@/components/runtime-endpoint-detail";

export default function McpEndpointDetailPage() {
  return (
    <Suspense fallback={null}>
      <RuntimeEndpointDetailPage kind="mcp" />
    </Suspense>
  );
}
