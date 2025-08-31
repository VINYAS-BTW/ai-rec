import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { LandingPage } from "./pages/LandingPage";
import Dashboard from "./pages/Dashboard"; 
import { Features } from "./components/Features";
import AboutUS from "./components/AboutUS";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/features" element={<Features></Features>}></Route>
        <Route path="/about" element={<AboutUS></AboutUS>}></Route>
      </Routes>
    </Router>
  );
}

export default App;
