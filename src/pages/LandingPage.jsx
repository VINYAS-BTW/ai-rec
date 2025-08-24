import AboutUS from "../components/AboutUS"
import Cta from "../components/Cta"
import { Features } from "../components/Features"
import Footer from "../components/Footer"
import HeroSec from "../components/HeroSec"
import HowtoUse from "../components/HowtoUse"
import Navbar from "../components/Navbar"
import Testimonials from "../components/Testimonials"



export const LandingPage = () => {
  return (
    <><Navbar></Navbar>
    <HeroSec></HeroSec>
    <Features></Features>
    <AboutUS></AboutUS>
    <Testimonials></Testimonials>
    <HowtoUse></HowtoUse>
    <Cta></Cta>
    <Footer></Footer>
    
    </>
  )
}
