import ReturnPage from "@/components/ReturnPage";
export const metadata = { title: "Finish payout setup · Operis" };
// Stripe Connect sends people here (?refresh=1) when the onboarding link expired or was interrupted.
export default function PayoutsRefresh() {
  return (
    <ReturnPage tone="info" eyebrow="Payouts" title="Let's finish your payout setup">
      <p>That setup link expired. Open your job link again and tap <strong>Set up payout</strong> to get a fresh one. Nothing you entered is lost.</p>
    </ReturnPage>
  );
}
