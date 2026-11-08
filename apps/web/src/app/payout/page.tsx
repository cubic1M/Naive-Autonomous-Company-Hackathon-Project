import Icon from "@/components/Icon";
import { Shell } from "@/components/ui";

// Payout setup lives at /j/<token>/payout, because the job link is the only credential. This page
// catches anyone who lands on /payout without one.
export default function Page() {
  return (
    <Shell>
      <section className="card stack center" style={{ padding: "32px 20px" }}>
        <div className="badge-icon"><Icon name="bank" size={28} /></div>
        <h1>Set up your payout</h1>
        <p className="muted">
          Open the job link we texted or emailed you. Once your proof is approved, you&apos;ll see a button to connect your bank account.
        </p>
      </section>
    </Shell>
  );
}
