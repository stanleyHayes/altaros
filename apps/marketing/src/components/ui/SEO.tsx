import { Helmet } from "react-helmet-async";

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  ogImage?: string;
  ogUrl?: string;
  canonical?: string;
}

const defaults = {
  title: "ALTAR OS — The Digital Operating System for the Church",
  description:
    "ALTAR OS is the all-in-one digital operating system for the modern church. Manage members, finances, events, and communications — built for African churches.",
  keywords:
    "church management, church software, tithe management, church CRM, African church, church app, mobile money, church attendance, church giving",
  ogImage: "/og-image.png",
  ogUrl: "https://altaros.io",
};

export default function SEO({
  title = defaults.title,
  description = defaults.description,
  keywords = defaults.keywords,
  ogImage = defaults.ogImage,
  ogUrl = defaults.ogUrl,
  canonical,
}: SEOProps) {
  const fullTitle =
    title === defaults.title
      ? title
      : `${title} | ALTAR OS`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />

      {/* Open Graph */}
      <meta property="og:type" content="website" />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:url" content={ogUrl} />
      <meta property="og:site_name" content="ALTAR OS" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />

      {/* Canonical */}
      {canonical && <link rel="canonical" href={canonical} />}
    </Helmet>
  );
}
