import { useState, useEffect } from "react";
import { motion } from "framer-motion";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <motion.nav
      initial={{ opacity: 0, y: -100 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        damping: 12,
        duration: 1.4,
        ease: "easeOut",
        delay: 0.3,
      }}
      className={`fixed left-1/2 transform -translate-x-1/2 
        w-[90%] md:w-[80%] z-50 
        rounded-4xl 
        transition-all duration-300 
        ${scrolled ? "bg-white shadow-lg" : "bg-neutral-100 shadow-md"}`}
      style={{ top: "1rem" }}
    >
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-16">
        {/* Logo */}
        <div className="text-2xl font-bold text-indigo-600 cursor-pointer">
          AiRec
        </div>

        {/* Desktop Menu */}
        <motion.div
          initial={{ opacity: 0, y: -100 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 1.4,
            ease: "easeOut",
            delay: 0.7,
          }}
          className="hidden md:flex space-x-8"
        >
          <a href="#features" className="text-gray-700 hover:text-indigo-600">
            Features
          </a>
          <a href="#pricing" className="text-gray-700 hover:text-indigo-600">
            Pricing
          </a>
          <a href="#contact" className="text-gray-700 hover:text-indigo-600">
            About Us
          </a>
        </motion.div>

        {/* Auth Buttons */}
        <motion.div
          initial={{ opacity: 0, y: -100 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 1.4,
            ease: "easeOut",
            delay: 0.7,
          }}
          className="hidden md:flex space-x-4"
        >
          <button className="text-gray-700 hover:text-indigo-600 cursor-pointer">
            Sign In
          </button>
          <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-3xl cursor-pointer">
            Sign Up
          </button>
        </motion.div>

        {/* Mobile Menu Button */}
        <div className="md:hidden">
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="text-gray-700 hover:text-indigo-600 text-2xl"
          >
            ☰
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div
          className="fixed top-16 left-0 right-0 bottom-0 w-full h-[calc(100vh-40rem)] rounded-3xl mt-2 p-5 md:hidden z-50 
             bg-neutral-200 backdrop-blur-lg shadow-lg transition-transform duration-300"
        >
          <nav className="flex flex-col gap-6 items-start h-full">
            <a
              href="#features"
              className="text-gray-700 hover:text-indigo-600 "
              onClick={() => setMobileOpen(false)}
            >
              Features
            </a>
            <a
              href="#pricing"
              className="text-gray-700 hover:text-indigo-600"
              onClick={() => setMobileOpen(false)}
            >
              Pricing
            </a>
            <a
              href="#contact"
              className="text-gray-700 hover:text-indigo-600"
              onClick={() => setMobileOpen(false)}
            >
              About Us
            </a>

            <button className="text-gray-700 hover:text-indigo-600">
              Sign In
            </button>
            <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 w-full rounded-3xl">
              Sign Up
            </button>
          </nav>
        </div>
      )}
    </motion.nav>
  );
}
