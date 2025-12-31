// src/components/OpenPlatformLink.tsx
"use client";

export default function OpenPlatformLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="ops-cta"
      title="Open the source system to address this issue"
    >
      {label}
    </a>
  );
}
