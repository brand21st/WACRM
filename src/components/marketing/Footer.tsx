import React from "react";
import Image from "next/image";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { PRODUCT_NAME, PRODUCT_DESCRIPTION } from "@/lib/brand";
import { APP_ORIGIN } from "@/lib/hosts";

const APP_LOGIN = `${APP_ORIGIN}/login`;
const APP_SIGNUP = `${APP_ORIGIN}/signup`;

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="wr">
        <div className="footer-top">
          <div className="footer-brand">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#03cf65] text-white">
                <MessageSquare className="h-4 w-4" strokeWidth={2.5} />
              </div>
              <span className="text-xl font-bold tracking-tight text-slate-900">
                {PRODUCT_NAME}
              </span>
            </Link>
            <p className="footer-desc">
              {PRODUCT_DESCRIPTION}
            </p>
            <div className="footer-socials">
              <a href="https://instagram.com" className="social-link" title="Instagram" target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
              </a>
              <a href="https://twitter.com" className="social-link" title="Twitter / X" target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
              </a>
              <a href="https://youtube.com" className="social-link" title="YouTube" target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"></path></svg>
              </a>
              <a href="https://linkedin.com" className="social-link" title="LinkedIn" target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"></path></svg>
              </a>
            </div>

            <div className="footer-app-badges">
              <a href="https://play.google.com/store" className="app-badge-link" target="_blank" rel="noopener noreferrer">
                <Image
                  src="https://umsousercontent.com/lib_HKfYfrNshcPpHcxs/8bo8xhe56gywx1ck.png?w=200&h=40&dpr=2"
                  alt="Download on Google Play"
                  width={150}
                  height={38}
                  style={{ width: "auto", height: "auto" }}
                />
              </a>
            </div>
          </div>

          <div className="footer-col">
            <h4>Product</h4>
            <ul className="footer-links">
              <li><a href="#broadcast">WhatsApp Broadcast</a></li>
              <li><a href="#live-chat">Multi-Agent Live Chat</a></li>
              <li><a href="#automation">Chatbot &amp; Automation</a></li>
              <li><a href="#ai-agents">WhatsApp AI Agents</a></li>
              <li><a href="#click-to-chat">Click to WhatsApp Ads</a></li>
              <li><a href="#forms">WhatsApp Forms</a></li>
              <li><a href="#payments">WhatsApp Payments</a></li>
            </ul>
          </div>

          <div className="footer-col">
            <h4>Industries</h4>
            <ul className="footer-links">
              <li><a href="#ecommerce">E-Commerce &amp; D2C</a></li>
              <li><a href="#education">Education &amp; EdTech</a></li>
              <li><a href="#real-estate">Real Estate</a></li>
              <li><a href="#finance">Fintech &amp; Banking</a></li>
              <li><a href="#testimonials">Customer Stories</a></li>
            </ul>
          </div>

          <div className="footer-col">
            <h4>Account &amp; App</h4>
            <ul className="footer-links">
              <li><a href={APP_LOGIN}>Open App / Sign In</a></li>
              <li><a href={APP_SIGNUP}>Create Account</a></li>
              <li><a href="#faq">FAQ &amp; Help</a></li>
            </ul>
          </div>

          <div className="footer-col">
            <h4>Legal &amp; Compliance</h4>
            <ul className="footer-links">
              <li><Link href="/privacy">Privacy Policy</Link></li>
              <li><Link href="/terms">Terms of Service</Link></li>
              <li><Link href="/data-deletion">Data Deletion</Link></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <div>&copy; {currentYear} {PRODUCT_NAME}. All rights reserved. Powered by Official WhatsApp Business APIs.</div>
          <div className="meta-partner-badge">
            <span>Official Meta Business Partner</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
