import NexoraApp from "@/components/nexora/NexoraApp";
import { legalConfig } from "@/lib/legal-config";

// Reads owner legal settings at request time.
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <NexoraApp legal={{ kind: "wallet", config: { ...legalConfig(), blocked: params.blocked === "1" } }}/>;
}
