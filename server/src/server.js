import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import api from "./routes/api.js";

dotenv.config();
const app=express();
app.use(cors({origin:process.env.CLIENT_URL?.split(",")||"*"}));
app.use(express.json());
app.get("/api/health",(_,res)=>res.json({status:"ok",service:"micropay-api"}));
app.use("/api",api);
const port=process.env.PORT||4000;
app.listen(port,()=>console.log(`Micro Pay API running on ${port}`));
