import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Layers, UserPlus } from "lucide-react";
import { API_AUTH } from "../api";
import { toast } from "react-toastify";

export default function Signup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API_AUTH}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      let result;
      try {
        result = await res.json();
      } catch {
        toast.error(res.ok ? "Invalid response" : "Signup failed");
        return;
      }
      const { success, message, error } = result;

      if (success) {
        toast.success(message || "Signup successful");
        navigate("/login", { replace: true });
        return;
      }

      toast.error(error || message || "Signup failed");
    } catch (err) {
      toast.error("Network error. Is the auth server running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-100 via-slate-100 to-neutral-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl border border-rose-100 p-8">
          <div className="flex items-center justify-center space-x-3 mb-8">
            <div className="w-12 h-12 bg-gradient-to-br from-red-600 to-cyan-800 rounded-xl flex items-center justify-center shadow-md">
              <Layers className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold bg-gradient-to-r from-neutral-800 to-rose-600 bg-clip-text text-transparent font-main">
                Recom BaaS
              </h1>
              <p className="text-sm text-gray-800 font-sec">Ai Based Recommendation System</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 font-third">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                minLength={3}
                maxLength={30}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all bg-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all bg-white"
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
                minLength={3}
                maxLength={30}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all bg-white"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3.5 font-semibold rounded-xl bg-gradient-to-br from-rose-900 via-neutral-950 to-cyan-900 hover:from-rose-800 hover:via-neitral-800 hover:to-cyan-800 text-white a transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <UserPlus className="w-5 h-5" />
              )}
              Sign up
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
                className="w-5 h-5 font-third"
              />
              Continue with Google
            </a>
          </div>

          <p className="mt-6 text-center text-sm text-gray-600">
            Already have an account?{" "}
            <Link to="/login" className="font-semibold text-rose-600 hover:text-rose-800">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
