import ReturnPage from "@/components/ReturnPage";
export const metadata = { title: "ID check submitted · Operis" };
export default function IdentityDone() {
  return (
    <ReturnPage tone="good" eyebrow="Identity" title="Thanks, we're checking your ID">
      <p>This usually takes a minute or two. Go back to your job link; it unlocks the proof upload as soon as your ID is verified.</p>
    </ReturnPage>
  );
}
