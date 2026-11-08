import ReturnPage from "@/components/ReturnPage";
export const metadata = { title: "Payment received · Operis" };
export default async function Funded({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ReturnPage tone="good" eyebrow="Payment held" title="Your job is funded">
      <p>Your card is <strong>held, not charged</strong>. You&apos;re only charged when the worker&apos;s proof passes verification; if the job fails or expires, the hold is released.</p>
      <p>Operis is finding a verified person now. Your agent can follow it with <span className="mono">get_job</span>, or you&apos;ll get the result at your callback URL.</p>
      <p className="small">Job <span className="mono">{id}</span>. You can close this tab.</p>
    </ReturnPage>
  );
}
