import { redirect } from "next/navigation";

export default async function McpEndpointDetailPage({
  params,
}: {
  params: Promise<{ endpointId: string }>;
}) {
  redirect(`/endpoints/${(await params).endpointId}`);
}
