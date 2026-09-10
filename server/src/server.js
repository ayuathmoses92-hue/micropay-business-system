import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import api from "./routes/api.js";
import auth from "./routes/auth.js";
import { authenticate } from "./middleware/auth.js";
import { authorizeRequest } from "./middleware/permissions.js";

dotenv.config();
const app=express();

app.use(cors({origin:process.env.CLIENT_URL?.split(",")||"*"}));
app.use(express.json());
app.get("/api/health",(_,res)=>res.json({status:"ok",service:"micropay-api"}));
app.use("/api/auth",auth);
app.use("/api",authenticate,authorizeRequest,api);
const port=process.env.PORT||4000;
app.listen(port,()=>console.log(`Micro Pay API running on ${port}`));
