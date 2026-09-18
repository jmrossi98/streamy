"use client";

import { SectionError } from "@/components/SectionError";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SectionError section="The admin panel" dependency="one of the services it monitors" {...props} />;
}
