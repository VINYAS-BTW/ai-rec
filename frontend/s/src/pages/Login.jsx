import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Layers, LogIn } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { API_AUTH } from "../api";
import { toast } from "react-toastify";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { loginSuccess } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API_AUTH}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      let result;
      try {
        result = await res.json();
      } catch {
        toast.error(res.ok ? "Invalid response" : "Login failed");
        return;
      }
      const { success, message, error, jwttoken, name } = result;

      if (success && jwttoken) {
        localStorage.setItem("token", jwttoken);
        localStorage.setItem("loggedInUser", name ?? "");
        loginSuccess();
        toast.success(message || "Login successful");
        navigate("/", { replace: true });
        return;
      }

      toast.error(error || message || "Login failed");
    } catch (err) {
      toast.error("Network error. Is the auth server running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-100 via-slate-100 to-neutral-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-4xl shadow-xl border border-gray-100 p-8">
          <div className="flex items-center justify-center space-x-3 mb-8">
            <div className="w-12 h-12 bg-gradient-to-br from-red-600 to-cyan-900 rounded-xl flex items-center justify-center shadow-md">
              <Layers className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold bg-gradient-to-r from-neutral-800 to-rose-600 bg-clip-text text-transparent font-main">
                Recom BaaS
              </h1>
              <p className="text-sm text-gray-800 font-sec">Ai based Recommendation System</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 font-third">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5 font-third">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-transparent transition-all bg-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-transparent transition-all bg-white"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3.5 font-semibold rounded-xl bg-gradient-to-r from-cyan-600 via-cyan-800 to-cyan-600 hover:from-cyan-800 hover:via-cyan-600 hover:to-cyan-800 text-white shadow-lg shadow-cyan-500/30 transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin font-third" />
              ) : (
                <LogIn className="w-5 h-5" />
              )}
              Sign in
            </button>
          </form>
          <div className="mt-6">
  <div className="flex items-center gap-3">
    <div className="flex-1 h-px bg-gray-200"></div>
    <span className="text-xs text-gray-400 font-medium">OR</span>
    <div className="flex-1 h-px bg-gray-200"></div>
  </div>

  <a
    href={`${API_AUTH}/auth/google`}
    className="mt-5 w-full flex items-center justify-center gap-3 px-6 py-3.5 border border-gray-200 rounded-xl font-semibold text-gray-700 hover:bg-gray-50 transition-all shadow-sm"
  >
    <img
      src="https://www.svgrepo.com/show/475656/google-color.svg"
      alt="google"
      className="w-5 h-5"
    />
    Continue with Google
  </a>
</div>


          <p className="mt-6 text-center text-sm text-gray-600">
            Don&apos;t have an account?{" "}
            <Link to="/signup" className="font-semibold text-cyan-600 hover:text-cyan-800">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
