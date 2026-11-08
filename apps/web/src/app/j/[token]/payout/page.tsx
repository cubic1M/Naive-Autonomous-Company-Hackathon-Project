import PayoutPage from "./PayoutPage";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PayoutPage token={token} />;
}
