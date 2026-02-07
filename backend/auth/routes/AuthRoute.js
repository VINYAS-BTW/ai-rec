import express from "express";
import {
  signup,
  login,
  googleLogin,
  googleCallback
} from "../controllers/AuthController.js";

import { signupValidation, loginValidation } from "../middlewares/AuthValidation.js";

const router = express.Router();

router.post("/signup", signupValidation, signup);
router.post("/login", loginValidation, login);
router.get("/google", googleLogin);
router.get("/google/callback", googleCallback);


export default router;
