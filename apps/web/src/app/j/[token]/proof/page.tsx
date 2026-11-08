import ProofPage from "./ProofPage";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ProofPage token={token} />;
}
