"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/app/ui";

export function SignOut() {
  const router = useRouter();
  return (
    <Button
      variant="quiet"
      size="md"
      onClick={async () => {
        await fetch("/api/agent/logout", { method: "POST" });
        router.push("/agent/login");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
