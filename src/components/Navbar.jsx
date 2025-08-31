import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

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

  const menuVariants = {
    hidden: { opacity: 0, y: -20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, ease: "easeOut", staggerChildren: 0.15 },
    },
    exit: { opacity: 0, y: -20, transition: { duration: 0.3 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.4 } },
  };

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
        <div className="hidden md:flex space-x-8">
          <a href="#features" className="text-gray-700 hover:text-indigo-600">
            Features
          </a>
          <a href="#pricing" className="text-gray-700 hover:text-indigo-600">
            Pricing
          </a>
          <a href="#contact" className="text-gray-700 hover:text-indigo-600">
            About Us
          </a>
        </div>

        {/* Auth Buttons */}
        <div className="hidden md:flex space-x-4">
          <button className="text-gray-700 hover:text-indigo-600 cursor-pointer">
            Sign In
          </button>
          <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-3xl cursor-pointer">
            Sign Up
          </button>
        </div>

        {/* Mobile Menu Button */}
        {/* Mobile Menu Button */}
        <div className="md:hidden">
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="relative w-2 h-6 flex flex-col justify-between items-center"
          >
            <motion.span
              animate={mobileOpen ? { rotate: 45, y: 8 } : { rotate: 0, y: 0 }}
              className="block h-1 w-6 bg-neutral-900 rounded"
              transition={{ duration: 0.3 }}
            />
            <motion.span
              animate={mobileOpen ? { opacity: 0 } : { opacity: 1 }}
              className="block h-1 w-4 bg-neutral-900 rounded"
              transition={{ duration: 0.3 }}
            />
            <motion.span
              animate={
                mobileOpen ? { rotate: -45, y: -8 } : { rotate: 0, y: 0 }
              }
              className="block h-1 w-6 bg-neutral-900 rounded"
              transition={{ duration: 0.3 }}
            />
          </button>
        </div>
      </div>

      {/* Mobile Menu with AnimatePresence */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed top-16 left-0 right-0 w-full h-[calc(38dvh-4rem)] z-50 
    bg-neutral-200 mt-2 shadow-lg rounded-3xl flex flex-col px-6 py-4 space-y-3"
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={menuVariants}
            >
              {/* Links */}
              <motion.a
                variants={itemVariants}
                href="#features"
                className="text-gray-700 hover:text-indigo-600 text-lg"
                onClick={() => setMobileOpen(false)}
              >
                Features
              </motion.a>
              <motion.a
                variants={itemVariants}
                href="#pricing"
                className="text-gray-700 hover:text-indigo-600 text-lg"
                onClick={() => setMobileOpen(false)}
              >
                Pricing
              </motion.a>
              <motion.a
                variants={itemVariants}
                href="#contact"
                className="text-gray-700 hover:text-indigo-600 text-lg"
                onClick={() => setMobileOpen(false)}
              >
                About Us
              </motion.a>

              {/* Auth buttons (no mt-auto → no push to bottom) */}
              <div className="flex flex-col gap-4 mt-6">
                <motion.button
                  variants={itemVariants}
                  className="text-gray-700 hover:text-indigo-600 text-lg"
                >
                  Sign In
                </motion.button>
                <motion.button
                  variants={itemVariants}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-3xl text-lg"
                >
                  Sign Up
                </motion.button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
