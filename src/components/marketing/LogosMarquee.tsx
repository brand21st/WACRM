import React from "react";
import Image from "next/image";

const logos = [
  { name: "AngelOne", src: "https://umsousercontent.com/lib_ToEGrUCsBdjFTDZP/9yf9f8jyghr118gq.png?w=280&h=200" },
  { name: "TATA", src: "https://d3jt6ku4g6z5l8.cloudfront.net/IMAGE/637206fccafb9d0eb4ba6428/8870923_images%201%201.png" },
  { name: "Bajaj Finance", src: "https://umsousercontent.com/lib_ToEGrUCsBdjFTDZP/cpk7qn5p35sqyofb.png?w=280&h=200" },
  { name: "Justdial", src: "https://d3jt6ku4g6z5l8.cloudfront.net/IMAGE/637206fccafb9d0eb4ba6428/2427591_images%203%201%201.png" },
  { name: "WTi Car Rental", src: "https://umsousercontent.com/lib_ToEGrUCsBdjFTDZP/j4azuc42bp084btm.png?w=280&h=200" },
  { name: "Adani", src: "https://d3jt6ku4g6z5l8.cloudfront.net/IMAGE/637206fccafb9d0eb4ba6428/4081303_Adani2012logo%201%202.png" },
  { name: "Aditya Birla Hindalco", src: "https://d3jt6ku4g6z5l8.cloudfront.net/IMAGE/637206fccafb9d0eb4ba6428/2525711_aditya%20birla%20hindalco%20logo1%201.png" },
  { name: "Wipro", src: "https://d3jt6ku4g6z5l8.cloudfront.net/IMAGE/637206fccafb9d0eb4ba6428/7372693_WiproPrimaryLogoColorRGB%201%202%201.png" },
  { name: "Delhi Transport Corporation", src: "https://d3jt6ku4g6z5l8.cloudfront.net/IMAGE/637206fccafb9d0eb4ba6428/5369728_DelhiTransportCorporation%201.png" },
  { name: "Vivo", src: "https://d3jt6ku4g6z5l8.cloudfront.net/IMAGE/637206fccafb9d0eb4ba6428/4270885_VivoLogo2009%201.png" },
  { name: "StayVista", src: "https://d3jt6ku4g6z5l8.cloudfront.net/IMAGE/637206fccafb9d0eb4ba6428/6894864_65151a8bd469782f64b31a81StayVistaLogoWarmBlackCMYKSVWarmBlackLogo1%201%205.png" },
  { name: "EatFit", src: "https://d3jt6ku4g6z5l8.cloudfront.net/IMAGE/637206fccafb9d0eb4ba6428/4972196_EatFit%201.png" },
  { name: "Digio", src: "https://d3jt6ku4g6z5l8.cloudfront.net/IMAGE/637206fccafb9d0eb4ba6428/2995876_digioblue%201.png" },
];

export default function LogosMarquee() {
  return (
    <section className="logos-section">
      <div className="wr">
        <div className="section-header">
          <h2 className="section-title">Founders &amp; Marketers Love us</h2>
          <p className="section-subtitle">Trusted by 210,000+ Businesses across 68+ Countries</p>
        </div>
      </div>

      <div className="marquee-container">
        <div className="marquee-track">
          {logos.map((logo, idx) => (
            <div className="marquee-item" key={`logo-1-${idx}`}>
              <Image
                src={logo.src}
                alt={logo.name}
                width={120}
                height={36}
                style={{ height: "36px", width: "auto", objectFit: "contain" }}
              />
            </div>
          ))}

          {/* Duplicate for infinite loop */}
          {logos.map((logo, idx) => (
            <div className="marquee-item" key={`logo-2-${idx}`}>
              <Image
                src={logo.src}
                alt={logo.name}
                width={120}
                height={36}
                style={{ height: "36px", width: "auto", objectFit: "contain" }}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
