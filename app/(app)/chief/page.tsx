import ChiefFull from "./ChiefFull";

// Chief — the whole-picture conversation, full screen. The persistent floating
// C opens the same conversation as an overlay sheet from every app screen.
export const dynamic = "force-dynamic";

export default function ChiefPage() {
  return <ChiefFull />;
}
