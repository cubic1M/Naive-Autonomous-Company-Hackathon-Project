import { redirect } from "next/navigation";
export default async function ProofRedirect({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/j/${token}`);
}
