import { Header } from "./sections/Header";
import { Hero } from "./sections/Hero";
import { HowItWorks } from "./sections/HowItWorks";
import { Screens } from "./sections/Screens";
import { ForEveryone } from "./sections/ForEveryone";
import { Trust } from "./sections/Trust";
import { GetStarted } from "./sections/GetStarted";
import { Faq } from "./sections/Faq";
import { Footer } from "./sections/Footer";

export function LandingPage() {
  return (
    <div className="lp-root">
      <Header />
      <main>
        <Hero />
        <HowItWorks />
        <Screens />
        <ForEveryone />
        <Trust />
        <GetStarted />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
