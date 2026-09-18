"use client";

import { SectionError } from "@/components/SectionError";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SectionError section="This show" dependency="the movie database or the home media server" {...props} />;
}
