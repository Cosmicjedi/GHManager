import type { Metadata } from "next";
import { TokenManager } from "@/components/TokenManager";

export const metadata: Metadata = {
  title: "Server tokens - GHManager",
  description: "Manage the GitHub tokens this GHManager server uses.",
};

export default function TokensPage() {
  return <TokenManager />;
}
