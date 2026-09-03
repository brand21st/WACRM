"use client";

import React, { useEffect, useRef } from "react";
import { APP_ORIGIN } from "@/lib/hosts";

interface MagicBarProps {
  isMenuOpen?: boolean;
}

export default function MagicBar({ isMenuOpen = false }: MagicBarProps) {
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function syncHeight() {
      if (barRef.current) {
        const h = barRef.current.offsetHeight;
        document.documentElement.style.setProperty("--banner-height", `${h}px`);
        document.body.style.setProperty("--banner-height", `${h}px`);
      }
    }

    syncHeight();
    window.addEventListener("resize", syncHeight);
    return () => window.removeEventListener("resize", syncHeight);
  }, []);

  return (
    <aside
      ref={barRef}
      id="aisensy-magic-bar"
      role="region"
      aria-label="Announcement"
      className={isMenuOpen ? "mb-menu-open" : ""}
    >
      <div className="mb-inner">
        <span className="mb-pill">
          <span className="mb-dot"></span>New Launch
        </span>
        <span className="mb-title">
          Build AI Agents on WhatsApp that qualify &amp; convert 24/7
        </span>
        <a
          className="mb-cta"
          href={`${APP_ORIGIN}/signup`}
        >
          <span className="mb-label">Explore More</span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14M13 6l6 6-6 6"></path>
          </svg>
        </a>
      </div>
    </aside>
  );
}
