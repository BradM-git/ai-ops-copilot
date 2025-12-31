// src/components/OpenPlatformButton.tsx
"use client";

export default function OpenPlatformButton({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        // Prevent <details> toggle when clicking link inside <summary>
        e.stopPropagation();
        // Allow navigation (do NOT preventDefault)
      }}
      className="inline-flex items-center justify-center rounded-lg border border-transparent bg-[var(--ops-accent)] px-3 py-2 text-sm font-semibold text-white hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-[var(--ops-focus)]"
      title="Open the source system to address this issue"
    >
      {label}
    </a>
  );
}
