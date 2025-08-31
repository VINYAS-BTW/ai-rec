import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { useState, useEffect } from "react";

import { LandingPage } from "./pages/LandingPage";
import Dashboard from "./pages/Dashboard";
import { Features } from "./components/Features";
import AboutUS from "./components/AboutUS";
import Loader from "./components/Loader"; // <- import loader

function App() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate initial loading (API/auth/config)
    const timer = setTimeout(() => setLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return <Loader />; // Show loader until loading is false
  }

  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/features" element={<Features />} />
        <Route path="/about" element={<AboutUS />} />
      </Routes>
    </Router>
  );
}

export default App;
