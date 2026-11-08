import ReturnPage from "@/components/ReturnPage";
export const metadata = { title: "Payouts set up · Operis" };
export default function PayoutsDone() {
  return (
    <ReturnPage tone="good" eyebrow="Payouts" title="Your bank account is set up">
      <p>We&apos;ll pay you for approved jobs. Stripe usually takes about 2 business days to deliver the first payout.</p>
      <p>Go back to your job link to see the job, or close this tab.</p>
    </ReturnPage>
  );
}
