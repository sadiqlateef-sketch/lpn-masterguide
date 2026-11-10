import type { Metadata } from "next";
import { SharedDeckScreen } from "@/components/screens/SharedDeckScreen";

// A lesson or question set a student shared (F20). Opens with no sign-in; the token is in ?t=.
export const metadata: Metadata = {
  title: "Shared study set · LPN MasterGuide",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function SharePage() {
  return <SharedDeckScreen />;
}
