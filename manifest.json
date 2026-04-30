import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export async function insertData(table, data) {
  const { error } = await supabase.from(table).insert(data);
  if (error) console.error(error);
}

export async function upsertData(table, data) {
  const { error } = await supabase.from(table).upsert(data);
  if (error) console.error(error);
}
