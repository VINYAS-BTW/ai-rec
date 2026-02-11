import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Layers, 
  Sparkles, 
  Menu, 
  X, 
  ArrowRight, 
  Check, 
  Zap, 
  Shield, 
  Activity,
  Code,
  Database,
  Webhook,
  BarChart3,
  Rocket,
  Users,
  Play,
  Star
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import Beams from "../components/Beams";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export default function Home() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("content");
  const [scrolled, setScrolled] = useState(false);

  const heroRef = useRef(null);
  const featuresRef = useRef(null);
  const stepsRef = useRef(null);
  const statsRef = useRef(null);

  const primaryLabel = isAuthenticated ? "Open dashboard" : "Get started";
  const primaryTarget = isAuthenticated ? "/app" : "/signup";

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    
    gsap.fromTo(
      heroRef.current?.querySelectorAll(".hero-badge"),
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.6, stagger: 0.1, ease: "power2.out" }
    );

    gsap.fromTo(
      heroRef.current?.querySelector(".hero-title"),
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 0.8, delay: 0.2, ease: "power2.out" }
    );

    gsap.fromTo(
      heroRef.current?.querySelector(".hero-subtitle"),
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.8, delay: 0.4, ease: "power2.out" }
    );

    gsap.fromTo(
      heroRef.current?.querySelectorAll(".hero-cta"),
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.6, delay: 0.6, stagger: 0.1, ease: "power2.out" }
    );

 
    gsap.fromTo(
      featuresRef.current?.querySelectorAll(".feature-card"),
      { opacity: 0, y: 50 },
      {
        opacity: 1,
        y: 0,
        duration: 0.8,
        stagger: 0.15,
        ease: "power2.out",
        scrollTrigger: {
          trigger: featuresRef.current,
          start: "top 80%",
        },
      }
    );

   
    gsap.fromTo(
      stepsRef.current?.querySelectorAll(".step-card"),
      { opacity: 0, x: -50 },
      {
        opacity: 1,
        x: 0,
        duration: 0.8,
        stagger: 0.2,
        ease: "power2.out",
        scrollTrigger: {
          trigger: stepsRef.current,
          start: "top 75%",
        },
      }
    );

  
    const stats = statsRef.current?.querySelectorAll(".stat-number");
    stats?.forEach((stat) => {
      const target = parseInt(stat.getAttribute("data-target"));
      gsap.to(stat, {
        innerText: target,
        duration: 2,
        snap: { innerText: 1 },
        scrollTrigger: {
          trigger: stat,
          start: "top 85%",
        },
        onUpdate: function () {
          stat.innerText = Math.ceil(stat.innerText).toLocaleString();
        },
      });
    });
  }, []);

  const navLinks = [
    { name: "Features", href: "#features" },
    { name: "How it works", href: "#how-it-works" },
    { name: "Pricing", href: "#pricing" },
   
  ];

  return (
    <div className="min-h-screen bg-white overflow-x-hidden">
   
      <nav
        className={`fixed top-2 left-4 right-4 z-50 transition-all duration-300 rounded-full ${
          scrolled
            ? "bg-rose-50/1 backdrop-blur-2xl border-b border-gray-200 shadow-lg"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
           
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              
              <div className="leading-tight">
                <p className="font-main text-xl font-bold bg-gradient-to-r from-rose-900 to-cyan-950 bg-clip-text text-transparent">
                  AiREC
                </p>
                
              </div>
            </div>

            {/* Desktop Navigation Links */}
            <div className="hidden lg:flex items-center gap-8">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  className="font-sec text-sm font-medium text-gray-700 hover:text-gray-950 transition-colors relative group"
                >
                  {link.name}
                  <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-gradient-to-r from-rose-500 to-cyan-500 group-hover:w-full transition-all duration-300"></span>
                </a>
              ))}
            </div>

            {/* Desktop CTA */}
            <div className="hidden lg:flex items-center gap-3">
              <button
                onClick={() => navigate("/login")}
                className="font-sec px-5 py-2.5 text-sm font-medium text-gray-700 hover:text-gray-950 transition-colors cursor-pointer"
              >
                Log in
              </button>
              <button
                onClick={() => navigate(primaryTarget)}
                className="font-sec px-6 py-2.5 rounded-full text-sm font-semibold bg-gradient-to-br from-rose-900 to-cyan-900 text-white  transition-all duration-300 shaow-lg cursor-pointer hover:bg-gradient-to-br hover:from rose-700 hover:to-cyan-700"
              >
                {primaryLabel}
              </button>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 text-gray-700 hover:text-gray-900"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-gray-200 bg-white shadow-xl rounded-3xl">
            <div className="px-4 py-6 space-y-4">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="font-sec block py-2 text-base font-medium text-gray-700 hover:text-rose-600 transition-colors"
                >
                  {link.name}
                </a>
              ))}
              <div className="pt-4 space-y-3 border-t border-gray-200">
                <button
                  onClick={() => {
                    navigate("/login");
                    setMobileMenuOpen(false);
                  }}
                  className="font-sec w-full px-5 py-3 text-sm font-medium text-gray-700 hover:text-gray-900 border-2 border-gray-200 rounded-xl transition-colors"
                >
                  Log in
                </button>
                <button
                  onClick={() => {
                    navigate(primaryTarget);
                    setMobileMenuOpen(false);
                  }}
                  className="font-sec w-full px-6 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-rose-500 to-cyan-500 text-white "
                >
                  {primaryLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section ref={heroRef} className="relative pt-32 pb-20 md:pt-40 md:pb-28 overflow-hidden">
       
        <div className="absolute inset-0 z-0 opacity-30">
          <Beams
            beamWidth={3}
            beamHeight={30}
            beamNumber={20}
            lightColor="#ffffff"
            speed={4}
            noiseIntensity={1.75}
            scale={0.2}
            rotation={30}
          />
        </div>

        {/* Gradient Overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-rose-500/10 to-white z-0" />
     

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-5xl mx-auto space-y-10">
            

            {/* Main Headline */}
            <h1 className="hero-title font-main text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-extrabold tracking-tight leading-[1.1]">
              Build powerful{" "}
              <span className="relative inline-block">
                <span className="bg-gradient-to-r from-rose-950 via-rose-500 to-cyan-950 bg-clip-text text-transparent">
                  recommendation
                </span>
                <svg
                  className="absolute -bottom-2 left-0 w-full h-3 text-rose-500/30"
                  viewBox="0 0 300 12"
                  fill="none"
                >
                  <path
                    d="M2 10C100 3 200 3 298 10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              </span>{" "}
              engines
            </h1>

            {/* Subheadline */}
            <p className="hero-subtitle font-sec text-lg sm:text-xl md:text-lg text-gray-600 max-w-3xl mx-auto leading-relaxed ">
              Upload your data, train ML models, and deploy production-ready recommendation APIs—all from a single platform. No infrastructure. No DevOps. No hassle.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-6">
              <button
                onClick={() => navigate(primaryTarget)}
                className="hero-cta font-sec group w-full sm:w-auto px-10 py-5 rounded-full text-lg font-bold bg-gradient-to-r from-rose-900 to-cyan-600 text-white  duration-300 flex items-center justify-center gap-3 cursor-pointer hover:shadow-lg shaow-white"
              >
              
                <span>{primaryLabel}</span>
                <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition-transform" />
              </button>
              <button
                onClick={() => navigate("/login")}
                className="hero-cta font-sec group w-full sm:w-auto px-10 py-5 rounded-2xl text-lg font-bold border-2 border-gray-300 text-gray-800 hover:border-rose-400 hover:text-gray-900 bg-white/90 backdrop-blur-sm transition-all duration-300 flex items-center justify-center gap-3 cursor-pointer"
              >
                <Play className="w-5 h-5" />
                <span>Watch demo</span>
              </button>
            </div>

           
          </div>
        </div>
      </section>

     

      {/* How It Works Section */}
      <section id="how-it-works" ref={stepsRef} className="py-20 md:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <span className="font-third text-sm font-semibold text-rose-800 uppercase tracking-wider">Workflow</span>
            <h2 className="font-main text-4xl sm:text-5xl md:text-6xl font-bold text-gray-900 mb-6 mt-3">
              From zero to production in three steps
            </h2>
             
            
          </div>

          <div className="grid lg:grid-cols-3 gap-12">
            {/* Step 1 */}
            <div className="step-card relative group">
              <div className="absolute -inset-4 bg-gradient-to-br from-rose-500 to-rose-600 rounded-3xl blur-2xl opacity-0  transition-opacity duration-500" />
              <div className="relative bg-white rounded-3xl p-10 shadow-xl border-2 border-gray-100  transition-all duration-300 h-full">
                <div className="flex items-center gap-4 mb-6">
                 
                  <Database className="w-6 h-6 text-rose-500" />
                </div>
                <h3 className="font-main text-2xl font-bold text-gray-900 mb-4">
                  Upload Your Data
                </h3>
                <p className="font-sec text-gray-600 leading-relaxed mb-6">
                  Drop in your CSV files with user interactions and item metadata. Our intelligent schema mapper handles the rest, auto-detecting fields and relationships.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                    <span className="font-third text-sm text-gray-700">Automatic data validation</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                    <span className="font-third text-sm text-gray-700">Schema auto-detection</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                    <span className="font-third text-sm text-gray-700">Supports millions of rows</span>
                  </li>
                </ul>
              </div>
            </div>
            

            {/* Step 2 */}
            <div className="step-card relative group">
              <div className="absolute -inset-4 bg-gradient-to-br from-rose-500 via-rose-400 to-cyan-400 rounded-3xl blur-2xl opacity-0  transition-opacity duration-500" />
              <div className="relative bg-white rounded-3xl p-10 shadow-xl border-2 border-gray-100 transition-all duration-300 h-full">
                <div className="flex items-center gap-4 mb-6">
                 
                  <Sparkles className="w-6 h-6 text-rose-500" />
                </div>
                <h3 className="font-main text-2xl font-bold text-gray-900 mb-4">
                  Train ML Models
                </h3>
                <p className="font-sec text-gray-600 leading-relaxed mb-6">
                  Select your algorithm—content-based, collaborative filtering, or hybrid. Click train and watch our distributed system do the heavy lifting in the cloud.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                    <span className="font-third text-sm text-gray-700">Multiple algorithm options</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                    <span className="font-third text-sm text-gray-700">Real-time training progress</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                    <span className="font-third text-sm text-gray-700">Hyperparameter tuning included</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Step 3 */}
            <div className="step-card relative group">
              <div className="absolute -inset-4 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-3xl blur-2xl opacity-0 group-hover:opacity-20 transition-opacity duration-500" />
              <div className="relative bg-white rounded-3xl p-10 shadow-xl border-2 border-gray-100 hover:border-cyan-200 transition-all duration-300 h-full">
                <div className="flex items-center gap-4 mb-6">
                  
                  <Webhook className="w-6 h-6 text-rose-500" />
                </div>
                <h3 className="font-main text-2xl font-bold text-gray-900 mb-4">
                  Deploy via API
                </h3>
                <p className="font-sec text-gray-600 leading-relaxed mb-6">
                  Generate API keys, register your apps.Call our /recommend Authentication, rate limiting, and monitoring—all handled automatically.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3 mt-1">
                    <Check className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                    <span className="font-third text-sm text-gray-700">Simple REST API</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                    <span className="font-third text-sm text-gray-700">JWT authentication built-in</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                    <span className="font-third text-sm text-gray-700">Webhook integrations</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" ref={featuresRef} className="py-20 md:py-32 bg-gradient-to-b from-white to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <span className="font-third text-sm font-semibold text-cyan-600 uppercase tracking-wider">Capabilities</span>
            <h2 className="font-main text-4xl sm:text-5xl md:text-6xl font-bold text-gray-900 mb-6 mt-3">
              Everything you need, nothing you don't
            </h2>
            <p className="font-sec text-xl text-gray-600 max-w-2xl mx-auto">
              Built-in features that would take months to implement yourself
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="feature-card group p-8 rounded-3xl bg-white border-2 border-gray-100 transition-all duration-300">
              
              <h3 className="font-main text-xl font-bold text-gray-900 mb-3">
                Lightning-Fast Training
              </h3>
              <p className="font-sec text-gray-600 leading-relaxed">
                Distributed infrastructure trains models on millions of interactions in minutes. Scale effortlessly as your data grows.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="feature-card group p-8 rounded-3xl bg-white border-2 border-gray-100 transition-all duration-300">
              
              <h3 className="font-main text-xl font-bold text-gray-900 mb-3">
                Enterprise Security
              </h3>
              <p className="font-sec text-gray-600 leading-relaxed">
                JWT auth, role-based access control, complete data isolation per account. SOC 2 Type II compliant infrastructure.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="feature-card group p-8 rounded-3xl bg-white border-2 border-gray-100  transition-all duration-300">
              
              <h3 className="font-main text-xl font-bold text-gray-900 mb-3">
                Real-Time Analytics
              </h3>
              <p className="font-sec text-gray-600 leading-relaxed">
                Monitor model performance, API usage, user engagement, and recommendation quality—all in a unified dashboard.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="feature-card group p-8 rounded-3xl bg-white border-2 border-gray-100 transition-all duration-300">
              
              <h3 className="font-main text-xl font-bold text-gray-900 mb-3">
                Developer-Friendly API
              </h3>
              <p className="font-sec text-gray-600 leading-relaxed">
                Clean REST API with comprehensive docs. SDKs for Python, JavaScript, and more. Postman collections included.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="feature-card group p-8 rounded-3xl bg-white border-2 border-gray-100  transition-all duration-300">
              
              <h3 className="font-main text-xl font-bold text-gray-900 mb-3">
                Multi-Project Management
              </h3>
              <p className="font-sec text-gray-600 leading-relaxed">
                Manage unlimited recommendation engines across different apps from a single account. Organize by workspace.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="feature-card group p-8 rounded-3xl bg-white border-2 border-gray-100  transition-all duration-300">
              
              <h3 className="font-main text-xl font-bold text-gray-900 mb-3">
                A/B Testing Built-In
              </h3>
              <p className="font-sec text-gray-600 leading-relaxed">
                Compare model variants, test different algorithms, measure impact on engagement. Statistical significance calculated automatically.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Demo Section */}
      <section className="py-20 md:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <span className="font-third text-sm font-semibold text-rose-600 uppercase tracking-wider">See It In Action</span>
              <h2 className="font-main text-4xl sm:text-5xl font-bold text-gray-900 mb-6 mt-3">
                Choose your recommendation algorithm
              </h2>
              <p className="font-sec text-lg text-gray-600 mb-8">
                Different use cases call for different approaches. Select the algorithm that best fits your data and goals.
              </p>

              {/* Tabs */}
              <div className="flex gap-3 mb-8 flex-wrap">
                <button
                  onClick={() => setActiveTab("content")}
                  className={`font-sec px-6 py-3 rounded-xl text-sm font-semibold transition-all ${
                    activeTab === "content"
                      ? "bg-gradient-to-r from-rose-500 to-rose-600 text-white shadow-lg"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Content-Based
                </button>
                <button
                  onClick={() => setActiveTab("collaborative")}
                  className={`font-sec px-6 py-3 rounded-xl text-sm font-semibold transition-all ${
                    activeTab === "collaborative"
                      ? "bg-gradient-to-r from-cyan-500 to-cyan-600 text-white shadow-lg"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Collaborative
                </button>
                <button
                  onClick={() => setActiveTab("hybrid")}
                  className={`font-sec px-6 py-3 rounded-xl text-sm font-semibold transition-all ${
                    activeTab === "hybrid"
                      ? "bg-gradient-to-r from-rose-500 to-cyan-500 text-white shadow-lg"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Hybrid
                </button>
              </div>

              {/* Tab Content */}
              <div className="bg-gray-50 rounded-3xl p-8 border border-gray-200">
                {activeTab === "content" && (
                  <div className="space-y-4">
                    <h4 className="font-main text-lg font-bold text-gray-900">Best for item-centric recommendations</h4>
                    <p className="font-sec text-gray-600">
                      Analyzes item attributes and metadata to find similar content. Perfect for cold-start scenarios and new users.
                    </p>
                    <ul className="space-y-3 pt-4">
                      <li className="flex items-start gap-3">
                        <Star className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                        <span className="font-third text-sm text-gray-700">Works immediately with new users</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <Star className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                        <span className="font-third text-sm text-gray-700">Explainable recommendations</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <Star className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                        <span className="font-third text-sm text-gray-700">Great for content platforms</span>
                      </li>
                    </ul>
                  </div>
                )}
                {activeTab === "collaborative" && (
                  <div className="space-y-4">
                    <h4 className="font-main text-lg font-bold text-gray-900">Best for user behavior patterns</h4>
                    <p className="font-sec text-gray-600">
                      Learns from user-item interactions to discover hidden preferences. Finds patterns you wouldn't expect.
                    </p>
                    <ul className="space-y-3 pt-4">
                      <li className="flex items-start gap-3">
                        <Star className="w-5 h-5 text-cyan-500 mt-0.5 flex-shrink-0" />
                        <span className="font-third text-sm text-gray-700">Discovers surprising connections</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <Star className="w-5 h-5 text-cyan-500 mt-0.5 flex-shrink-0" />
                        <span className="font-third text-sm text-gray-700">Improves with more user data</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <Star className="w-5 h-5 text-cyan-500 mt-0.5 flex-shrink-0" />
                        <span className="font-third text-sm text-gray-700">Best for e-commerce & media</span>
                      </li>
                    </ul>
                  </div>
                )}
                {activeTab === "hybrid" && (
                  <div className="space-y-4">
                    <h4 className="font-main text-lg font-bold text-gray-900">Best of both worlds</h4>
                    <p className="font-sec text-gray-600">
                      Combines content features with collaborative signals. Handles cold-start while leveraging behavioral data.
                    </p>
                    <ul className="space-y-3 pt-4">
                      <li className="flex items-start gap-3">
                        <Star className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                        <span className="font-third text-sm text-gray-700">Maximum recommendation quality</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <Star className="w-5 h-5 text-cyan-500 mt-0.5 flex-shrink-0" />
                        <span className="font-third text-sm text-gray-700">Solves cold-start problem</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <Star className="w-5 h-5 text-rose-500 mt-0.5 flex-shrink-0" />
                        <span className="font-third text-sm text-gray-700">Our most popular option</span>
                      </li>
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Code Preview */}
            <div className="relative">
              
              <div className="relative bg-gray-900 rounded-3xl p-8 shadow-2xl overflow-hidden">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-3 h-3 rounded-full bg-rose-500"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span className="font-sec text-xs text-gray-400 ml-4">api_example.py</span>
                </div>
                <pre className="font-mono text-sm text-gray-300 overflow-x-auto">
                  <code>{`import requests

# Get recommendations
response = requests.post(
  "https://api.airec.io/v1/recommend",
  headers={
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  json={
    "user_id": "user_12345",
    "project_id": "movies_hybrid",
    "n_items": 10,
    "filters": {
      "genre": ["sci-fi", "thriller"],
      "min_year": 2020
    }
  }
)

recommendations = response.json()
# Returns: [
#   {"item_id": "tt1234", "score": 0.95},
#   {"item_id": "tt5678", "score": 0.89},
#   ...
# ]`}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 md:py-32 bg-gradient-to-b from-white to-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="font-third text-sm font-semibold text-rose-600 uppercase tracking-wider">Pricing</span>
            <h2 className="font-main text-4xl sm:text-5xl md:text-6xl font-bold text-gray-900 mb-6 mt-3">
              Its free, we'll scale as we grow
            </h2>
            <p className="font-sec text-xl text-gray-600 max-w-2xl mx-auto">
              Testing with you , so that we can know its working well...!
            </p>
          </div>

          
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative py-24 md:py-40 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-rose-600 via-rose-500 to-cyan-500" />
        <div className="absolute inset-0 opacity-30">
          <Beams
            beamWidth={3.5}
            beamHeight={25}
            beamNumber={15}
            lightColor="#ffffff"
            speed={5}
            noiseIntensity={1.5}
            scale={0.2}
            rotation={-30}
          />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-main text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-8 leading-tight">
            Its  in the testing stage 
          </h2>
          <p className="font-sec text-xl md:text-2xl text-white/95 mb-12 max-w-3xl mx-auto leading-relaxed">
           We hope you would check it out once :/
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-5">
            <button
              onClick={() => navigate(primaryTarget)}
              className="font-sec group px-12 py-5 rounded-full text-lg font-bold bg-white text-rose-600   transition-all duration-300 inline-flex items-center gap-3"
            >
              <span>{primaryLabel}</span>
              <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition-transform" />
            </button>
           
          </div>
          <p className="font-third text-sm text-white/80 mt-8">
             5-minute setup •  No credit card required • Start building immediately
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-12 mb-12">
            <div className="md:col-span-1">
              <div className="flex items-center gap-3 mb-4">
                
                <div className="leading-tight">
                  <p className="font-main text-xl font-bold text-white">AiREC</p>
                  <p className="font-sec text-xs text-gray-400">Recommendation BaaS Studio</p>
                </div>
              </div>
              <p className="font-sec text-sm text-gray-400 leading-relaxed">
                The fastest way to build and deploy production-ready recommendation engines.
              </p>
            </div>

            <div>
              <h4 className="font-main text-sm font-bold text-white mb-4 uppercase tracking-wider">Product</h4>
              <ul className="space-y-3">
                <li><a href="#features" className="font-sec text-sm text-gray-400 hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="font-sec text-sm text-gray-400 hover:text-white transition-colors">Pricing</a></li>
                
               
              </ul>
            </div>

            <div>
              <h4 className="font-main text-sm font-bold text-white mb-4 uppercase tracking-wider">People </h4>
              <ul className="space-y-3">
                <li><a href="#" className="font-sec text-sm text-gray-400 hover:text-white transition-colors">Rohit R Bhat</a></li>
                <li><a href="#" className="font-sec text-sm text-gray-400 hover:text-white transition-colors">Sai Vinyas BS</a></li>
                <li><a href="#" className="font-sec text-sm text-gray-400 hover:text-white transition-colors">Saiyam Jn</a></li>
                <li><a href="#" className="font-sec text-sm text-gray-400 hover:text-white transition-colors">Sourabh Katti</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-main text-sm font-bold text-white mb-4 uppercase tracking-wider">Legal</h4>
              <ul className="space-y-3">
                <li><a href="#" className="font-sec text-sm text-gray-400 hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="font-sec text-sm text-gray-400 hover:text-white transition-colors">Terms of Service</a></li>
                <li><a href="#" className="font-sec text-sm text-gray-400 hover:text-white transition-colors">Security</a></li>
                
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-gray-800 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="font-third text-sm text-gray-400">
              © 2026 AiREC. All rights reserved.
            </p>
            
          </div>
        </div>
      </footer>
    </div>
  );
}