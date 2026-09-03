import React from "react";
import Image from "next/image";
import { APP_ORIGIN } from "@/lib/hosts";

const APP_SIGNUP = `${APP_ORIGIN}/signup`;

export default function BroadcastSection() {
  return (
    <section id="broadcast" className="broadcast-section">
      <div className="wr">
        <div className="feature-two-col">
          <div className="feature-col-content">
            <h2 className="section-title" style={{ textAlign: "left" }}>
              Broadcast Marketing Messages on WhatsApp (Officially)
            </h2>
            <p className="section-subtitle" style={{ textAlign: "left", margin: 0 }}>
              Enjoy a Limitless Broadcasting experience on WhatsApp
            </p>

            <ul className="feature-points">
              <li className="feature-point-item">
                <div className="feature-point-icon">
                  <Image
                    src="https://umsousercontent.com/lib_bylSIrVINmKpCoJQ/y402w4axyqwt3m3z.png?w=24&h=24&dpr=2"
                    alt="Megaphone icon"
                    width={22}
                    height={22}
                  />
                </div>
                <div>
                  <h3 className="feature-point-title">8+ Powerful Messaging Categories</h3>
                  <p className="feature-point-desc">
                    Send Promotions, Offers, Coupon codes, Carousels and More- Risk-Free!
                  </p>
                </div>
              </li>

              <li className="feature-point-item">
                <div className="feature-point-icon">
                  <Image
                    src="https://umsousercontent.com/lib_bylSIrVINmKpCoJQ/1fieb932kqxiin4w.png?w=24&h=24&dpr=2"
                    alt="Chat conversation icon"
                    width={22}
                    height={22}
                  />
                </div>
                <div>
                  <h3 className="feature-point-title">Add CTAs. Drive 3x Conversions</h3>
                  <p className="feature-point-desc">
                    Turn conversations into conversions with eye-catching CTA and Quick Reply buttons
                  </p>
                </div>
              </li>

              <li className="feature-point-item">
                <div className="feature-point-icon">
                  <Image
                    src="https://umsousercontent.com/lib_bylSIrVINmKpCoJQ/b8h3rh4grkml4j5s.png?w=24&h=24&dpr=2"
                    alt="Text message icon"
                    width={22}
                    height={22}
                  />
                </div>
                <div>
                  <h3 className="feature-point-title">Schedule your WhatsApp messages</h3>
                  <p className="feature-point-desc">
                    Streamline your work, Schedule Broadcasts 2 months ahead of time
                  </p>
                </div>
              </li>
            </ul>

            <div>
              <a
                href={APP_SIGNUP}
                className="btn btn-primary btn-large"
              >
                <span>Start for FREE</span>
                <svg viewBox="0 0 15 12" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9.6 7H1a1 1 0 1 1 0-2h8.6L7 2.4A1 1 0 0 1 8.4 1l4.3 4.2c.2.3.3.5.3.8 0 .3-.1.5-.3.7L8.4 11A1 1 0 1 1 7 9.5L9.6 7z" fill="currentColor"></path>
                </svg>
              </a>
            </div>
          </div>

          <div className="feature-col-visual">
            <Image
              src="https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/2cbv2iqtg8phy296.webp"
              alt="WhatsApp Broadcast Interface Mockup"
              width={600}
              height={500}
              style={{ width: "100%", height: "auto" }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
