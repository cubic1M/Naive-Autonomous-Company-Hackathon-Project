import Icon from "@/components/Icon";
import { Shell } from "@/components/ui";

export default function NotFound() {
  return (
    <Shell>
      <section className="card stack center" style={{ padding: "32px 20px" }}>
        <div className="badge-icon"><Icon name="x" size={28} /></div>
        <h1>Page not found</h1>
        <p className="muted">Check the link in your message and try again.</p>
      </section>
    </Shell>
  );
}
