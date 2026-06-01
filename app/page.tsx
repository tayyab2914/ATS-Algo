import { redirect } from "next/navigation";

/** Entry point — funnels visitors to the login surface. */
export default function Home() {
  redirect("/login");
}
