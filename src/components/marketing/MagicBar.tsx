"use client";

import React, { useState, useEffect, useRef } from "react";
import { APP_ORIGIN } from "@/lib/hosts";

interface MagicBarProps {
  isMenuOpen?: boolean;
}

export default function MagicBar({ isMenuOpen = false }: MagicBarProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function syncHeight() {
      if (isDismissed) {
        document.documentElement.style.setProperty("--banner-height", "0px");
        document.body.style.setProperty("--banner-height", "0px");
        return;
      }
      if (barRef.current) {
        const h = barRef.current.offsetHeight;
        document.documentElement.style.setProperty("--banner-height", `${h}px`);
        document.body.style.setProperty("--banner-height", `${h}px`);
      }
    }

    syncHeight();
    window.addEventListener("resize", syncHeight);
    return () => window.removeEventListener("resize", syncHeight);
  }, [isDismissed]);

  const handleDismiss = () => {
    setIsDismissed(true);
    document.documentElement.style.setProperty("--banner-height", "0px");
    document.body.style.setProperty("--banner-height", "0px");
  };

  if (isDismissed) {
    return null;
  }

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

        {/* Mobile & Desktop Dismiss Button */}
        <button
          type="button"
          className="mb-close-btn"
          onClick={handleDismiss}
          aria-label="Close Announcement Bar"
          title="Close announcement"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </aside>
  );
}
