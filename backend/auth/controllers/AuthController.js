import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import * as User from "../models/user.js";

export const signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({
        message: "User already exists",
        success: false,
      });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({ name, email, password: hashedPassword });
    return res.status(201).json({
      message: "Signup successful",
      success: true,
    });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const existingUser = await User.findByEmail(email);
    if (!existingUser) {
      return res.status(403).json({
        message: "Auth failed",
        success: false,
      });
    }
    const match = await bcrypt.compare(password, existingUser.password);
    if (!match) {
      return res.status(403).json({
        message: "password didnt match",
        success: false,
      });
    }
    const jwttoken = jwt.sign(
      { email: existingUser.email, id: existingUser.id },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );
    return res.status(200).json({
      message: "login successful",
      success: true,
      jwttoken,
      email: existingUser.email,
      name: existingUser.name,
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};


export const googleLogin = (req, res) => {
  const redirect_uri = "http://localhost:8080/auth/google/callback";
  console.log("Redirect URI:", redirect_uri);


  const url =
    "https://accounts.google.com/o/oauth2/v2/auth" +
    `?client_id=${process.env.GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${redirect_uri}` +
    "&response_type=code" +
    "&scope=openid%20email%20profile" +
    "&access_type=offline";

  res.redirect(url);
};

import axios from "axios";
export const googleCallback = async (req, res) => {
  try {
    

    const code = req.query.code;
    

    // exchange code
    const params = new URLSearchParams();
    params.append("code", code);
    params.append("client_id", process.env.GOOGLE_CLIENT_ID);
    params.append("client_secret", process.env.GOOGLE_CLIENT_SECRET);
    params.append(
      "redirect_uri",
      "http://localhost:8080/auth/google/callback"
    );
    params.append("grant_type", "authorization_code");

    const tokenRes = await axios.post(
      "https://oauth2.googleapis.com/token",
      params,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

  



    const access_token = tokenRes.data.access_token;

    // Step 2 — get user info
    const userRes = await axios.get(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    const { email, name } = userRes.data;

    // Step 3 — find or create user
    let existingUser = await User.findByEmail(email);

    if (!existingUser) {
      await User.create({
        name,
        email,
        password: null,
      });

      existingUser = await User.findByEmail(email);
    }

    // Step 4 — create JWT
    const jwttoken = jwt.sign(
      { email: existingUser.email, id: existingUser.id },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    // Step 5 — redirect frontend
    res.redirect(
      `http://localhost:5173/oauth-success?token=${jwttoken}`
    );

  } catch (err) {
  console.error(err);
  console.error(err?.response?.data);
  res.redirect("http://localhost:5173/login");
}

};
