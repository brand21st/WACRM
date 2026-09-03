import React from "react";
import Image from "next/image";

const g2Badges = [
  { name: "High Performer", src: "https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/r1kfg311hv6iquny.png" },
  { name: "Easiest To Use", src: "https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/kid7rwu3jqe1uuxi.png" },
  { name: "Best Support", src: "https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/kgv5p793mnxdjn5c.png" },
  { name: "Leader", src: "https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/f4kxb9vxtnakgnf0.png" },
  { name: "Users Love Us", src: "https://umsousercontent.com/lib_EyxlwrMuBuWXHRhZ/p8taspv7a3c6kc58.png" },
];

export default function G2Awards() {
  return (
    <section className="g2-awards-section">
      <div className="wr">
        <div className="section-header">
          <h2 className="section-title">
            #1 WhatsApp Marketing &amp; Engagement Platform for startups &amp; growing businesses
          </h2>
        </div>

        <div className="g2-grid">
          {g2Badges.map((badge, idx) => (
            <Image
              key={idx}
              src={badge.src}
              alt={`G2 ${badge.name} Badge`}
              className="g2-badge-img"
              width={100}
              height={120}
              style={{ width: "auto", height: "auto" }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
