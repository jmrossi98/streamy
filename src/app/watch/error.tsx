"use client";

import { SectionError } from "@/components/SectionError";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SectionError section="Playback" dependency="the home media server" {...props} />;
}
