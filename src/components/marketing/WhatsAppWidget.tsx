import React from "react";
import { PRODUCT_NAME } from "@/lib/brand";

export default function WhatsAppWidget() {
  return (
    <a
      href="https://wa.me/918848772371?text=Hi%2C%20I%20am%20interested%20in%20WhatsApp%20CRM"
      className="floating-wa-widget"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Chat with ${PRODUCT_NAME} Support on WhatsApp`}
    >
      <div className="wa-badge-popup">
        <strong>Need help?</strong>
        The team typically replies in under 1h
      </div>
      <div className="wa-btn">
        <svg viewBox="0 0 32 32">
          <path d="M16 2a13.93 13.93 0 0 0-12.08 20.89L2 30l7.35-1.92A13.94 13.94 0 1 0 16 2zm0 25.5a11.53 11.53 0 0 1-5.88-1.61l-.42-.25-4.37 1.15 1.17-4.25-.27-.44A11.55 11.55 0 1 1 16 27.5zm6.33-8.67c-.35-.17-2.06-1-2.38-1.12s-.55-.17-.79.17-.9 1.12-1.1 1.35-.41.26-.76.09a9.55 9.55 0 0 1-2.81-1.73 10.53 10.53 0 0 1-1.95-2.43c-.2-.35 0-.54.15-.71s.35-.41.52-.61a2.36 2.36 0 0 0 .35-.58.64.64 0 0 0 0-.61c-.09-.17-.79-1.9-1.08-2.61s-.58-.6-.79-.61h-.67a1.3 1.3 0 0 0-.94.44 3.94 3.94 0 0 0-1.23 2.93c0 1.73 1.26 3.4 1.43 3.64s2.48 3.79 6 5.31c.84.36 1.49.58 2 .74a4.8 4.8 0 0 0 2.2.14 3.6 3.6 0 0 0 2.37-1.67 2.92 2.92 0 0 0 .2-1.67c-.08-.14-.29-.23-.64-.4z"></path>
        </svg>
        <span className="wa-status-dot"></span>
      </div>
    </a>
  );
}
