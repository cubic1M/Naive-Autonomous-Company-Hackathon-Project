import type { ReactNode } from "react";

import Icon, { Logo } from "./Icon";

export function Shell({ children, bar }: { children: ReactNode; bar?: ReactNode }) {
  return (
    <>
      <main className="shell">
        <header>
          <span className="brand">
            <Logo />
            operis.
          </span>
        </header>
        {children}
      </main>
      {bar && (
        <div className="actionbar">
          <div>{bar}</div>
        </div>
      )}
    </>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <Shell>
      <section className="card stack" aria-busy="true" aria-label={label}>
        <div className="skeleton" style={{ height: 22, width: "55%" }} />
        <div className="skeleton" style={{ height: 40, width: "35%" }} />
        <div className="skeleton" style={{ height: 70 }} />
      </section>
    </Shell>
  );
}

export function Message({
  icon,
  title,
  children,
  bar,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  title: string;
  children?: ReactNode;
  bar?: ReactNode;
}) {
  return (
    <Shell bar={bar}>
      <section className="card stack center" style={{ padding: "32px 20px" }}>
        <div className="badge-icon">
          <Icon name={icon} size={28} />
        </div>
        <h1>{title}</h1>
        {children}
      </section>
    </Shell>
  );
}

export const Expired = () => (
  <Message icon="hourglass" title="This link has expired">
    <p className="muted">
      Job links only work for a limited time. If we have another job near you, we&apos;ll send you a new link.
    </p>
  </Message>
);

export const Offline = ({ retry }: { retry: () => void }) => (
  <Message
    icon="signal"
    title="Can't reach Operis"
    bar={
      <button className="btn" onClick={retry}>
        Try again
      </button>
    }
  >
    <p className="muted">Your connection looks weak. Move somewhere with better signal and try again.</p>
  </Message>
);
