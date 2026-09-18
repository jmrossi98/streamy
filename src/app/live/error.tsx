"use client";

import { SectionError } from "@/components/SectionError";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SectionError section="Live TV" dependency="the home media server" {...props} />;
}
