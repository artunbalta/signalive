import { ConsentForm } from "@/components/consent/ConsentForm";

/** ?reset=1: sent back here because the server lost the agreement (see AppShell). */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ reset?: string | string[] }> }) {
  const { reset } = await searchParams;
  return <ConsentForm reset={reset === "1"} />;
}
