"use client";

import { Suspense } from "react";
import { RuntimeEndpointDetailPage } from "@/components/runtime-endpoint-detail";

export default function HttpApiDetailPage() {
  return (
    <Suspense fallback={null}>
      <RuntimeEndpointDetailPage kind="http" />
    </Suspense>
  );
}
