import ReturnPage from "@/components/ReturnPage";
export const metadata = { title: "Payment cancelled · Operis" };
export default async function Cancelled({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ReturnPage tone="warn" eyebrow="Not paid" title="Payment cancelled">
      <p>Nothing was charged and the job hasn&apos;t started. To go ahead, open the payment link your agent gave you again, or ask your agent to request the job again.</p>
      <p className="small">Job <span className="mono">{id}</span></p>
    </ReturnPage>
  );
}
