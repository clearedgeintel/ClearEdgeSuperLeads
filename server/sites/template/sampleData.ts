import type { BusinessData } from "@shared/sites";
import { SAMPLE_TESTIMONIAL_AUTHOR } from "@shared/sites";

// Hardcoded sample used to render /s/sample before DB wiring (Phase 3) and as a
// fixture. Demonstrates the labeled-sample testimonials and a null-phone case is
// covered separately in tests.
export const SAMPLE_BUSINESS: BusinessData = {
  name: "Lone Star Roofing Co.",
  category: "Roofing Contractor",
  city: "Austin",
  state: "TX",
  phone: "(512) 555-0142",
  website: "https://lonestarroofing.example.com",
  rating: 4.8,
  reviewCount: 126,
  tagline: "Durable roofs, honest work, lasting protection",
  about:
    "Lone Star Roofing has helped Central Texas homeowners protect what matters most for over fifteen years. The team focuses on quality installation, clear communication, and standing behind every job.",
  services: [
    { name: "Roof Replacement", desc: "Full tear-off and new roof systems" },
    { name: "Storm Damage Repair", desc: "Fast response after hail and wind" },
    { name: "Roof Inspections", desc: "Detailed reports for buyers and owners" },
    { name: "Gutter Installation", desc: "Seamless gutters sized to your home" },
    { name: "Emergency Tarping", desc: "Same-day leak protection when it counts" },
  ],
  serviceAreas: ["Austin", "Round Rock", "Cedar Park", "Pflugerville", "Georgetown"],
  hours: "Mon–Sat 7am–6pm",
  yearsInBusiness: "15+ years",
  brandColor: "#b91c1c",
  testimonials: [
    {
      text: "They replaced our roof in two days and cleaned up like they were never here. Highly recommend.",
      author: SAMPLE_TESTIMONIAL_AUTHOR,
    },
    {
      text: "Honest quote, no upselling, and the crew was professional from start to finish.",
      author: SAMPLE_TESTIMONIAL_AUTHOR,
    },
  ],
  mapsUrl: "https://www.google.com/maps/place/Lone+Star+Roofing/@30.2672,-97.7431,15z",
};
