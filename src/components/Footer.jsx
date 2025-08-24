import { FaLinkedin, FaGithub, } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";

const Footer = () => {
  return (
    <footer className="bg-gray-900 text-gray-300 py-12">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 grid gap-8 md:grid-cols-4">
        
        {/* Brand */}
        <div>
          <h2 className="text-2xl font-bold text-white">AiRec</h2>
          <p className="mt-4 text-sm text-gray-400">
            Smarter recommendations, powered by AI — helping you make better decisions every day.
          </p>
        </div>

        {/* Quick Links */}
        <div>
          <h3 className="text-lg font-semibold text-white">Quick Links</h3>
          <ul className="mt-4 space-y-2">
            <li><a href="#features" className="hover:text-white">Features</a></li>
            <li><a href="#about" className="hover:text-white">About Us</a></li>
            <li><a href="#testimonials" className="hover:text-white">Testimonials</a></li>
            <li><a href="#how" className="hover:text-white">How It Works</a></li>
          </ul>
        </div>

        {/* Support */}
        <div>
          <h3 className="text-lg font-semibold text-white">Support</h3>
          <ul className="mt-4 space-y-2">
            <li><a href="#faq" className="hover:text-white">FAQ</a></li>
            <li><a href="#contact" className="hover:text-white">Contact</a></li>
            <li><a href="#privacy" className="hover:text-white">Privacy Policy</a></li>
            <li><a href="#terms" className="hover:text-white">Terms of Service</a></li>
          </ul>
        </div>

        {/* Social */}
        <div>
          <h3 className="text-lg font-semibold text-white">Follow Us</h3>
          <div className="flex space-x-4 mt-4">
            <a href="#" className="hover:text-white"><FaLinkedin size={20} /></a>
            <a href="#" className="hover:text-white"><FaGithub size={20} /></a>
            <a href="#" className="hover:text-white"><FaXTwitter size={20} /></a>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="mt-12 border-t border-gray-700 pt-6 text-center text-sm text-gray-500">
        © {new Date().getFullYear()} AiRec. All rights reserved.
      </div>
    </footer>
  );
};

export default Footer;
