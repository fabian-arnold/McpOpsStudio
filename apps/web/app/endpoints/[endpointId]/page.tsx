"use client";

import { Suspense } from "react";
import { RuntimeEndpointDetailPage } from "@/components/runtime-endpoint-detail";

export default function EndpointDetailPage() {
  return (
    <Suspense fallback={null}>
      <RuntimeEndpointDetailPage />
    </Suspense>
  );
}
