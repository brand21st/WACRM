import React from "react";
import Image from "next/image";
import { APP_ORIGIN } from "@/lib/hosts";

const APP_SIGNUP = `${APP_ORIGIN}/signup`;

export default function Onboarding() {
  return (
    <section className="onboard-section">
      <div className="wr">
        <div className="onboard-two-col">
          <div>
            <h2 className="section-title" style={{ textAlign: "left" }}>
              Start WhatsApp Marketing in 10 Minutes
            </h2>
            <p className="section-subtitle" style={{ textAlign: "left", margin: 0 }}>
              Platform powered by Official Whatsapp Business APIs and in alignment with all WhatsApp Rules.
            </p>

            <ul className="onboard-features">
              <li className="onboard-item">
                <div className="onboard-icon">
                  <Image
                    src="https://umsousercontent.com/lib_LhuefaHhCaLhDedO/citegv6melgetvc1.svg?w=24&h=24&dpr=2"
                    alt="Green tick icon"
                    width={22}
                    height={22}
                  />
                </div>
                <div>
                  <h3 className="onboard-item-title">Official Green Tick Verification</h3>
                  <p className="onboard-item-desc">
                    Get Verified Green Tick on your WhatsApp. Broadcast Unlimited Notifications everyday.
                  </p>
                </div>
              </li>

              <li className="onboard-item">
                <div className="onboard-icon">
                  <Image
                    src="https://umsousercontent.com/lib_LhuefaHhCaLhDedO/kbs540ttd2qgzx1x.svg?w=24&h=24&dpr=2"
                    alt="Chat support icon"
                    width={22}
                    height={22}
                  />
                </div>
                <div>
                  <h3 className="onboard-item-title">Dedicated Live Chat Support</h3>
                  <p className="onboard-item-desc">
                    Priority Support over WhatsApp, Phone, Live Chat &amp; Email.
                  </p>
                </div>
              </li>

              <li className="onboard-item">
                <div className="onboard-icon">
                  <Image
                    src="https://umsousercontent.com/lib_LhuefaHhCaLhDedO/mtalk24spidt8xto.svg?w=24&h=24&dpr=2"
                    alt="Lightning fast icon"
                    width={22}
                    height={22}
                  />
                </div>
                <div>
                  <h3 className="onboard-item-title">Blazing Fast Feature launches</h3>
                  <p className="onboard-item-desc">
                    We&apos;re constantly adding new WhatsApp features, so you can always offer the best experience to your customers.
                  </p>
                </div>
              </li>
            </ul>

            <div>
              <a
                href={APP_SIGNUP}
                className="btn btn-primary btn-large"
              >
                <span>Start Now for FREE</span>
                <svg viewBox="0 0 15 12" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9.6 7H1a1 1 0 1 1 0-2h8.6L7 2.4A1 1 0 0 1 8.4 1l4.3 4.2c.2.3.3.5.3.8 0 .3-.1.5-.3.7L8.4 11A1 1 0 1 1 7 9.5L9.6 7z" fill="currentColor"></path>
                </svg>
              </a>
            </div>
          </div>

          <div className="onboard-visual">
            <Image
              src="https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/bfe60rjxdht3o9im.webp"
              alt="Get WABA Dashboard in 10 minutes"
              width={600}
              height={450}
              style={{ width: "100%", height: "auto" }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
