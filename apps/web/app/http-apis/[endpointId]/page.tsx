import { redirect } from "next/navigation";

export default async function HttpApiDetailPage({
  params,
}: {
  params: Promise<{ endpointId: string }>;
}) {
  redirect(`/endpoints/${(await params).endpointId}`);
}
