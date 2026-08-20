import { redirect } from "next/navigation";

export default function RootPage() {
  // The (app) layout bounces unauthenticated visitors on to /login.
  redirect("/dashboard");
}
