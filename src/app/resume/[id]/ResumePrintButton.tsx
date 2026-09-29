"use client";

export function ResumePrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border border-neutral-300 bg-white px-3 py-1 text-neutral-800 hover:bg-neutral-50"
    >
      Save as PDF
    </button>
  );
}
