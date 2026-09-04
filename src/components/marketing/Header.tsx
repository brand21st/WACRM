"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { APP_ORIGIN } from "@/lib/hosts";
import { PRODUCT_NAME } from "@/lib/brand";

const APP_LOGIN = `${APP_ORIGIN}/login`;
const APP_SIGNUP = `${APP_ORIGIN}/signup`;

interface HeaderProps {
  onMenuToggle?: (isOpen: boolean) => void;
}

export default function Header({ onMenuToggle }: HeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(event.target as Node)) {
        setLangOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleDrawer = (open: boolean) => {
    setDrawerOpen(open);
    if (onMenuToggle) onMenuToggle(open);
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
  };

  const toggleSubmenu = (id: string) => {
    setOpenSubmenu(openSubmenu === id ? null : id);
  };

  return (
    <>
      <header className={`site-header ${scrolled ? "scrolled" : ""}`}>
        <div className="wr header-inner">
          {/* Logo */}
          <Link href="/" className="brand-logo flex items-center gap-2" title={`${PRODUCT_NAME} Homepage`}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#03cf65] text-white">
              <MessageSquare className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900">
              {PRODUCT_NAME}
            </span>
          </Link>

          {/* Desktop Nav Menu */}
          <nav aria-label="Primary Navigation">
            <ul className="nav-menu">
              <li className="nav-item">
                <a href="#features" className="nav-link">
                  Features
                </a>
              </li>

              <li className="nav-item">
                <Link href="/pricing" className="nav-link">
                  Pricing
                </Link>
              </li>

              {/* Product */}
              <li className="nav-item">
                <span className="nav-link" tabIndex={0}>
                  Product{" "}
                  <svg className="chevron" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 1l4 4 4-4"></path>
                  </svg>
                </span>
                <div className="nav-flyout">
                  <ul className="flyout-list">
                    <li>
                      <a href="#broadcast" className="flyout-link">
                        <div className="flyout-icon">📢</div>
                        <div>
                          <span className="flyout-title">WhatsApp Broadcast</span>
                          <span className="flyout-desc">Send unlimited marketing messages</span>
                        </div>
                      </a>
                    </li>
                    <li>
                      <a href="#live-chat" className="flyout-link">
                        <div className="flyout-icon">💬</div>
                        <div>
                          <span className="flyout-title">Multi-Agent Live Chat</span>
                          <span className="flyout-desc">Shared inbox for customer support</span>
                        </div>
                      </a>
                    </li>
                    <li>
                      <a href="#automation" className="flyout-link">
                        <div className="flyout-icon">🤖</div>
                        <div>
                          <span className="flyout-title">Chatbot &amp; Automation</span>
                          <span className="flyout-desc">No-code bot &amp; trigger flows</span>
                        </div>
                      </a>
                    </li>
                    <li>
                      <a href="#ai-agents" className="flyout-link">
                        <div className="flyout-icon">⚡</div>
                        <div>
                          <span className="flyout-title">AI Agents</span>
                          <span className="flyout-desc">Autonomous 24/7 lead qualification</span>
                        </div>
                      </a>
                    </li>
                  </ul>
                </div>
              </li>

              {/* Features */}
              <li className="nav-item">
                <span className="nav-link" tabIndex={0}>
                  Solutions{" "}
                  <svg className="chevron" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 1l4 4 4-4"></path>
                  </svg>
                </span>
                <div className="nav-flyout">
                  <ul className="flyout-list">
                    <li>
                      <a href="#click-to-chat" className="flyout-link">
                        <div className="flyout-icon">🎯</div>
                        <div>
                          <span className="flyout-title">Click to WhatsApp Ads</span>
                          <span className="flyout-desc">5X conversions from Meta Ads</span>
                        </div>
                      </a>
                    </li>
                    <li>
                      <a href="#forms" className="flyout-link">
                        <div className="flyout-icon">📝</div>
                        <div>
                          <span className="flyout-title">WhatsApp Forms</span>
                          <span className="flyout-desc">Native lead capture in chat</span>
                        </div>
                      </a>
                    </li>
                    <li>
                      <a href="#payments" className="flyout-link">
                        <div className="flyout-icon">💳</div>
                        <div>
                          <span className="flyout-title">WhatsApp Payments</span>
                          <span className="flyout-desc">In-chat seamless checkout</span>
                        </div>
                      </a>
                    </li>
                    <li>
                      <a href="#analytics" className="flyout-link">
                        <div className="flyout-icon">📊</div>
                        <div>
                          <span className="flyout-title">Real-Time Analytics</span>
                          <span className="flyout-desc">Track clicks, reads, &amp; conversions</span>
                        </div>
                      </a>
                    </li>
                  </ul>
                </div>
              </li>

              {/* Industries */}
              <li className="nav-item">
                <span className="nav-link" tabIndex={0}>
                  Industries{" "}
                  <svg className="chevron" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 1l4 4 4-4"></path>
                  </svg>
                </span>
                <div className="nav-flyout">
                  <ul className="flyout-list">
                    <li>
                      <a href="#ecommerce" className="flyout-link">
                        <div className="flyout-icon">🛍️</div>
                        <div>
                          <span className="flyout-title">E-Commerce &amp; D2C</span>
                          <span className="flyout-desc">Recover carts &amp; boost sales</span>
                        </div>
                      </a>
                    </li>
                    <li>
                      <a href="#education" className="flyout-link">
                        <div className="flyout-icon">🎓</div>
                        <div>
                          <span className="flyout-title">Education &amp; EdTech</span>
                          <span className="flyout-desc">Automate admissions &amp; alerts</span>
                        </div>
                      </a>
                    </li>
                    <li>
                      <a href="#real-estate" className="flyout-link">
                        <div className="flyout-icon">🏢</div>
                        <div>
                          <span className="flyout-title">Real Estate</span>
                          <span className="flyout-desc">Instant property lead routing</span>
                        </div>
                      </a>
                    </li>
                    <li>
                      <a href="#finance" className="flyout-link">
                        <div className="flyout-icon">🏦</div>
                        <div>
                          <span className="flyout-title">Fintech &amp; Banking</span>
                          <span className="flyout-desc">Secure OTPs &amp; notifications</span>
                        </div>
                      </a>
                    </li>
                  </ul>
                </div>
              </li>

              {/* Resources */}
              <li className="nav-item">
                <span className="nav-link" tabIndex={0}>
                  Resources{" "}
                  <svg className="chevron" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 1l4 4 4-4"></path>
                  </svg>
                </span>
                <div className="nav-flyout">
                  <ul className="flyout-list">
                    <li>
                      <a href="#faq" className="flyout-link">
                        <div className="flyout-icon">💡</div>
                        <div>
                          <span className="flyout-title">FAQ</span>
                          <span className="flyout-desc">Frequently asked questions</span>
                        </div>
                      </a>
                    </li>
                    <li>
                      <a href="#testimonials" className="flyout-link">
                        <div className="flyout-icon">🏆</div>
                        <div>
                          <span className="flyout-title">Customer Stories</span>
                          <span className="flyout-desc">How 210,000+ brands scale</span>
                        </div>
                      </a>
                    </li>
                  </ul>
                </div>
              </li>

              <li className="nav-item">
                <Link href="/privacy" className="nav-link">
                  Privacy
                </Link>
              </li>
            </ul>
          </nav>

          {/* Language Picker & Action Buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div className="lang-picker" ref={langRef}>
              <button
                type="button"
                onClick={() => setLangOpen(!langOpen)}
                className="lang-btn"
                aria-label="Select Language"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
                Eng
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 1l4 4 4-4"></path>
                </svg>
              </button>
              <ul className={`lang-menu ${langOpen ? "open" : ""}`}>
                <li><a href="#" onClick={(e) => { e.preventDefault(); setLangOpen(false); }}>English</a></li>
                <li><a href="#" onClick={(e) => { e.preventDefault(); setLangOpen(false); }}>हिन्दी, हिंदी</a></li>
                <li><a href="#" onClick={(e) => { e.preventDefault(); setLangOpen(false); }}>Español</a></li>
                <li><a href="#" onClick={(e) => { e.preventDefault(); setLangOpen(false); }}>Português</a></li>
                <li><a href="#" onClick={(e) => { e.preventDefault(); setLangOpen(false); }}>العربية</a></li>
              </ul>
            </div>

            <div className="header-actions">
              <a
                href={APP_SIGNUP}
                className="btn btn-primary"
              >
                <span>Start for FREE</span>
                <svg viewBox="0 0 15 12" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9.6 7H1a1 1 0 1 1 0-2h8.6L7 2.4A1 1 0 0 1 8.4 1l4.3 4.2c.2.3.3.5.3.8 0 .3-.1.5-.3.7L8.4 11A1 1 0 1 1 7 9.5L9.6 7z" fill="currentColor"></path>
                </svg>
              </a>
              <a
                href={APP_LOGIN}
                className="btn btn-secondary"
              >
                <span>Login</span>
                <svg viewBox="0 0 15 12" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9.6 7H1a1 1 0 1 1 0-2h8.6L7 2.4A1 1 0 0 1 8.4 1l4.3 4.2c.2.3.3.5.3.8 0 .3-.1.5-.3.7L8.4 11A1 1 0 1 1 7 9.5L9.6 7z" fill="currentColor"></path>
                </svg>
              </a>
            </div>

            {/* Mobile Toggle */}
            <button
              type="button"
              className="mobile-toggle"
              onClick={() => toggleDrawer(true)}
              aria-label="Open Mobile Menu"
            >
              <span></span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Menu */}
      <div
        className={`mobile-drawer-overlay ${drawerOpen ? "open" : ""}`}
        onClick={() => toggleDrawer(false)}
      ></div>
      <div className={`mobile-drawer ${drawerOpen ? "open" : ""}`}>
        <div className="drawer-header">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#03cf65] text-white">
              <MessageSquare className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900">
              {PRODUCT_NAME}
            </span>
          </div>
          <button
            type="button"
            className="drawer-close"
            onClick={() => toggleDrawer(false)}
            aria-label="Close Mobile Menu"
          >
            &times;
          </button>
        </div>

        <ul className="drawer-links">
          <li><a href="#features" onClick={() => toggleDrawer(false)}>Features</a></li>
          <li><Link href="/pricing" onClick={() => toggleDrawer(false)}>Pricing</Link></li>
          <li>
            <button
              type="button"
              onClick={() => toggleSubmenu("product")}
            >
              Product{" "}
              <span style={{ transform: openSubmenu === "product" ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                ▾
              </span>
            </button>
            <ul className={`drawer-submenu ${openSubmenu === "product" ? "open" : ""}`}>
              <li><a href="#broadcast" onClick={() => toggleDrawer(false)}>WhatsApp Broadcast</a></li>
              <li><a href="#live-chat" onClick={() => toggleDrawer(false)}>Multi-Agent Live Chat</a></li>
              <li><a href="#automation" onClick={() => toggleDrawer(false)}>Chatbot &amp; Automation</a></li>
              <li><a href="#ai-agents" onClick={() => toggleDrawer(false)}>AI Agents</a></li>
            </ul>
          </li>
          <li>
            <button
              type="button"
              onClick={() => toggleSubmenu("features")}
            >
              Solutions{" "}
              <span style={{ transform: openSubmenu === "features" ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                ▾
              </span>
            </button>
            <ul className={`drawer-submenu ${openSubmenu === "features" ? "open" : ""}`}>
              <li><a href="#click-to-chat" onClick={() => toggleDrawer(false)}>Click to WhatsApp Ads</a></li>
              <li><a href="#forms" onClick={() => toggleDrawer(false)}>WhatsApp Forms</a></li>
              <li><a href="#payments" onClick={() => toggleDrawer(false)}>WhatsApp Payments</a></li>
              <li><a href="#analytics" onClick={() => toggleDrawer(false)}>Real-Time Analytics</a></li>
            </ul>
          </li>
          <li>
            <button
              type="button"
              onClick={() => toggleSubmenu("industries")}
            >
              Industries{" "}
              <span style={{ transform: openSubmenu === "industries" ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                ▾
              </span>
            </button>
            <ul className={`drawer-submenu ${openSubmenu === "industries" ? "open" : ""}`}>
              <li><a href="#ecommerce" onClick={() => toggleDrawer(false)}>E-Commerce &amp; D2C</a></li>
              <li><a href="#education" onClick={() => toggleDrawer(false)}>Education &amp; EdTech</a></li>
              <li><a href="#real-estate" onClick={() => toggleDrawer(false)}>Real Estate</a></li>
              <li><a href="#finance" onClick={() => toggleDrawer(false)}>Fintech &amp; Banking</a></li>
            </ul>
          </li>
          <li><Link href="/privacy" onClick={() => toggleDrawer(false)}>Privacy</Link></li>
        </ul>

        <div className="drawer-actions">
          <a
            href={APP_SIGNUP}
            className="btn btn-primary"
            style={{ width: "100%" }}
          >
            Start for FREE
          </a>
          <a
            href={APP_LOGIN}
            className="btn btn-secondary"
            style={{ width: "100%" }}
          >
            Login
          </a>
        </div>
      </div>
    </>
  );
}
