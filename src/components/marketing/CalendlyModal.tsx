"use client";

import React, { useEffect } from "react";

interface CalendlyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CalendlyModal({ isOpen, onClose }: CalendlyModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.75)",
        zIndex: 999999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "960px",
          height: "85vh",
          background: "#ffffff",
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: "0 25px 60px rgba(0,0,0,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Booking Modal"
          style={{
            position: "absolute",
            top: "12px",
            right: "16px",
            width: "36px",
            height: "36px",
            borderRadius: "50%",
            background: "rgba(0,0,0,0.6)",
            color: "#ffffff",
            border: "none",
            fontSize: "24px",
            lineHeight: "36px",
            textAlign: "center",
            cursor: "pointer",
            zIndex: 1000000,
          }}
        >
          &times;
        </button>
        <iframe
          src="https://calendly.com/d/3k8-k9q-9r3?hide_gdpr_banner=1"
          title="Book a Live Demo"
          style={{ width: "100%", height: "100%", border: 0, display: "block" }}
        ></iframe>
      </div>
    </div>
  );
}
