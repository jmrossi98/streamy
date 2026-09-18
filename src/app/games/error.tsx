"use client";

import { SectionError } from "@/components/SectionError";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SectionError section="Games" dependency="the game library on the home server" {...props} />;
}
