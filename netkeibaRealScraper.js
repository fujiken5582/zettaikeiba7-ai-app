import express from "express";
import dotenv from "dotenv";
import { supabase } from "./db/supabaseClient.js";
import { predict } from "./model/lgbmModel.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "競馬AI API" });
});

app.get("/api/shutuba", async (req, res) => {
  const { data, error } = await supabase.from("shutuba").select("*");
  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.get("/api/results", async (req, res) => {
  const { data, error } = await supabase.from("race_results").select("*");
  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.get("/api/predict", async (req, res) => {
  const { data } = await supabase.from("shutuba").select("*").limit(10);
  const predictions = await predict(data || []);
  res.json(predictions);
});

app.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
});
